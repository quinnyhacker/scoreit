// Score It - Node server (no runtime dependencies). Game state is authoritative here and held in memory.
// Secrets (SPOTIFY_*, PEXELS_API_KEY, PIXABAY_API_KEY) come from the environment only, never the browser.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const library = require('./lib/library');
const { limiter } = require('./lib/ratelimit');

const PORT = process.env.PORT || 3000;
const HAS_SEARCH = !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
const TRUST_PROXY = process.env.TRUST_PROXY !== '0';
const rooms = new Map();
const MAX_BODY = 3 * 1024 * 1024;
const MAX_PLAYERS = 12;
const ROOM_IDLE_MS = 3 * 3600 * 1000;
const ONLINE_MS = 15000;          // seen within 15s = online
const HOST_AWAY_MS = 60000;       // host gone this long and others online -> hand over host
const PLAYER_DROP_MS = 20 * 60000;

const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 20);
const httpErr = (code, msg) => { const e = new Error(msg); e.status = code; return e; };
const CODE_RE = /^[A-Z]{4}$/, PID_RE = /^[a-f0-9]{16}$/;

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += chars[crypto.randomInt(chars.length)]; if (!rooms.has(c)) return c; }
}
const touch = (room) => { room.v++; room.updated = Date.now(); };

/* ---------- rate limits (per client IP) ---------- */
const limits = { global: limiter(2400, 60000), create: limiter(20, 600000), join: limiter(60, 600000), search: limiter(60, 60000), library: limiter(120, 60000), pick: limiter(120, 60000), scene: limiter(60, 60000) };
const clientIp = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
function limit(name, req) { const r = limits[name](clientIp(req)); if (!r.ok) { const e = httpErr(429, `You're doing that a lot. Try again in ${r.retry}s.`); e.retry = r.retry; throw e; } }

/* ---------- Spotify ---------- */
const TRACK_RE = /(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/;
const parseTrackId = (s) => { const m = TRACK_RE.exec(String(s || '')); return m ? m[1] : null; };
async function trackMeta(id) {
  try {
    const r = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent('https://open.spotify.com/track/' + id), { signal: AbortSignal.timeout(5000) });
    if (r.status === 404 || r.status === 400) return null;       // not a real track
    if (r.ok) { const j = await r.json(); return { title: String(j.title || 'Unknown track').slice(0, 120), thumb: j.thumbnail_url || '' }; }
  } catch { /* network hiccup: fall through */ }
  return { title: 'Spotify track', thumb: '' };
}
let tokenCache = { token: null, exp: 0 };
async function spotifyToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const basic = Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('token');
  const j = await r.json(); tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 }; return tokenCache.token;
}
async function search(q) {
  const token = await spotifyToken();
  const r = await fetch('https://api.spotify.com/v1/search?type=track&limit=10&q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(6000) });
  if (r.status === 401) tokenCache = { token: null, exp: 0 };
  if (!r.ok) throw new Error('search ' + r.status);
  const j = await r.json();
  return j.tracks.items.map((t) => ({ id: t.id, title: t.name, artist: t.artists.map((a) => a.name).join(', '), thumb: (t.album.images[t.album.images.length - 2] || t.album.images[0] || {}).url || '' }));
}

/* ---------- room helpers ---------- */
function getRoom(code, pid) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) throw httpErr(404, 'We couldn\'t find that game. It may have ended, or the code is wrong.');
  if (pid !== undefined) { if (!room.players[pid]) throw httpErr(404, 'You\'re no longer in this game.'); room.players[pid].lastSeen = Date.now(); }
  room.active = Date.now();
  return room;
}
const hostOnly = (room, pid) => { if (pid !== room.hostId) throw httpErr(403, 'Only the host can do that.'); };
const isOnline = (p) => Date.now() - p.lastSeen < ONLINE_MS;
const orderedIds = (room) => Object.keys(room.players).sort((a, b) => room.players[a].joinedAt - room.players[b].joinedAt);
const nextHost = (room) => { const ids = orderedIds(room); return ids.find((i) => isOnline(room.players[i])) || ids[0]; };

function viewFor(room, pid) {
  const players = orderedIds(room).map((id) => { const p = room.players[id]; return { id, name: p.name, score: p.score, isHost: id === room.hostId, picked: !!room.picks[id], voted: !!room.votes[id], online: isOnline(p) }; });
  const out = { v: room.v, code: room.code, phase: room.phase, round: room.round, scene: room.scene, me: { id: pid, name: room.players[pid].name, isHost: pid === room.hostId },
    players, picks: [], myPick: null, myVote: room.votes[pid] || null };
  const mine = room.picks[pid]; if (mine) out.myPick = { title: mine.title, trackId: mine.trackId, thumb: mine.thumb };
  if (room.phase === 'voting') out.picks = room.order.map((id) => { const p = room.pickById[id]; return { id, trackId: p.trackId, title: p.title, thumb: p.thumb, mine: p.author === pid }; });
  else if (room.phase === 'results') out.picks = room.order.map((id) => { const p = room.pickById[id];
    const voters = Object.entries(room.votes).filter(([, t]) => t === id).map(([v]) => (room.players[v] || { name: 'Someone' }).name);
    return { id, trackId: p.trackId, title: p.title, thumb: p.thumb, mine: p.author === pid, author: (room.players[p.author] || { name: 'Someone' }).name, voters }; }).sort((a, b) => b.voters.length - a.voters.length);
  return out;
}
function beginVoting(room) {
  room.phase = 'voting'; room.pickById = {};
  for (const [author, p] of Object.entries(room.picks)) room.pickById[rid(3)] = { ...p, author };
  room.order = Object.keys(room.pickById).sort(() => crypto.randomInt(3) - 1); room.votes = {};
}
function finishRound(room) {
  if (room.phase !== 'voting') return;                       // scoring happens exactly once per round
  for (const t of Object.values(room.votes)) { const p = room.pickById[t]; if (p && room.players[p.author]) room.players[p.author].score += 100; }
  room.phase = 'results';
}
const canVote = (room, id) => Object.values(room.pickById).some((p) => p.author !== id);
function maybeFinish(room) {
  if (room.phase !== 'voting') return;
  const voters = Object.keys(room.players).filter((id) => canVote(room, id));
  if (!voters.length || voters.every((id) => room.votes[id])) finishRound(room);
}
function removePlayer(room, pid) {
  if (!room.players[pid]) return;
  delete room.players[pid];
  if (!Object.keys(room.players).length) { rooms.delete(room.code); return; }
  if (room.hostId === pid) room.hostId = nextHost(room);
  delete room.picks[pid]; delete room.votes[pid];
  if (room.phase === 'voting') {
    for (const [id, p] of Object.entries(room.pickById)) if (p.author === pid) {
      delete room.pickById[id]; room.order = room.order.filter((x) => x !== id);
      for (const [v, t] of Object.entries(room.votes)) if (t === id) delete room.votes[v];
    }
    if (!room.order.length) room.phase = 'results'; else maybeFinish(room);
  }
  touch(room);
}

/* ---------- scenes ---------- */
function validCustomScene(s) {
  if (!s || typeof s !== 'object') throw httpErr(400, 'Choose a scene first.');
  const caption = String(s.caption || '').trim().slice(0, 200);
  const httpsUrl = (u) => /^https:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '';
  if (s.kind === 'text') { if (!caption) throw httpErr(400, 'Describe the scene first.'); return { kind: 'text', caption, credit: null, license: null }; }
  if (s.kind === 'image') {
    const url = String(s.url || '');
    if (!(httpsUrl(url) || /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(url))) throw httpErr(400, 'Use an https image link or upload a png/jpeg/gif/webp photo.');
    return { kind: 'image', url, caption, credit: null, license: null };
  }
  if (s.kind === 'video') { const url = httpsUrl(s.url); if (!url) throw httpErr(400, 'Use an https link to an mp4/webm video.'); return { kind: 'video', url, poster: '', caption, credit: null, license: null }; }
  if (s.kind === 'youtube') {
    const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/))([A-Za-z0-9_-]{11})/.exec(String(s.url || ''));
    if (!m) throw httpErr(400, 'Paste a YouTube link.'); return { kind: 'youtube', id: m[1], caption, credit: null, license: null };
  }
  throw httpErr(400, 'Choose a scene first.');
}

/* ---------- routes ---------- */
const routes = {
  'POST /api/create': async (b, req) => {
    limit('create', req);
    const name = cleanName(b.name); if (!name) throw httpErr(400, 'Enter your name to host a game.');
    const code = newCode(), pid = rid(8);
    rooms.set(code, { code, v: 1, updated: Date.now(), active: Date.now(), hostId: pid, phase: 'setup', round: 0, scene: null, used: new Set(),
      players: { [pid]: { name, score: 0, lastSeen: Date.now(), joinedAt: Date.now() } }, picks: {}, votes: {}, pickById: {}, order: [] });
    return { code, pid };
  },
  'POST /api/join': async (b, req) => {
    limit('join', req);
    const code = String(b.code || '').toUpperCase().trim();
    if (!CODE_RE.test(code)) throw httpErr(400, 'Room codes are 4 letters, like ABCD.');
    const room = rooms.get(code); if (!room) throw httpErr(404, `We couldn't find a game with code ${code}. Check the code, or ask the host for a new invite link.`);
    const name = cleanName(b.name); if (!name) throw httpErr(400, 'Enter your name to join.');
    if (Object.keys(room.players).length >= MAX_PLAYERS) throw httpErr(400, 'This game is full.');
    if (Object.values(room.players).some((p) => p.name.toLowerCase() === name.toLowerCase())) throw httpErr(400, 'Someone in this game already has that name. Try another.');
    const pid = rid(8); room.players[pid] = { name, score: 0, lastSeen: Date.now(), joinedAt: Date.now() }; room.active = Date.now(); touch(room);
    return { code, pid };
  },
  'POST /api/leave': async (b) => { const room = getRoom(b.code, b.pid); removePlayer(room, b.pid); return { ok: true }; },
  'POST /api/scene': async (b, req) => {
    limit('scene', req);
    const room = getRoom(b.code, b.pid); hostOnly(room, b.pid);
    if (room.phase !== 'setup' && room.phase !== 'results') throw httpErr(400, 'A round is already in progress.');
    let scene;
    if (b.random) { const it = library.random(['video', 'image', 'text'].includes(b.random) ? b.random : 'any', room.used); if (!it) throw httpErr(503, 'No scenes are available yet.'); scene = library.toScene(it); }
    else if (b.libraryId) { const it = library.get(String(b.libraryId)); if (!it) throw httpErr(404, 'That scene is no longer available. Pick another.'); scene = library.toScene(it); }
    else scene = validCustomScene(b.scene);
    if (scene.libraryId) room.used.add(scene.libraryId);
    room.scene = scene; room.phase = 'picking'; room.round++; room.picks = {}; room.votes = {}; room.pickById = {}; room.order = []; touch(room);
    return { ok: true };
  },
  'POST /api/pick': async (b, req) => {
    limit('pick', req);
    const room = getRoom(b.code, b.pid);
    if (room.phase !== 'picking') throw httpErr(400, 'Song picks are closed for this round.');
    const id = parseTrackId(b.url || ('spotify:track:' + b.trackId));
    if (!id) throw httpErr(400, 'That doesn\'t look like a Spotify song link. In Spotify choose ••• › Share › Copy Song Link.');
    if (room.picks[b.pid] && room.picks[b.pid].trackId === id) return { ok: true, unchanged: true };
    const meta = await trackMeta(id); if (!meta) throw httpErr(400, 'Spotify couldn\'t find that song. Try a different link.');
    if (room.phase !== 'picking') throw httpErr(400, 'Song picks are closed for this round.');   // re-check after the await
    if (b.title) meta.title = String(b.title).slice(0, 120);
    room.picks[b.pid] = { trackId: id, ...meta }; touch(room);
    return { ok: true };
  },
  'POST /api/phase': async (b) => {
    const room = getRoom(b.code, b.pid); hostOnly(room, b.pid);
    if (b.to === 'voting' && room.phase === 'picking') { if (!Object.keys(room.picks).length) throw httpErr(400, 'Wait for at least one song first.'); beginVoting(room); }
    else if (b.to === 'results' && room.phase === 'voting') finishRound(room);
    else throw httpErr(400, 'That step isn\'t available right now.');
    touch(room); return { ok: true };
  },
  'POST /api/vote': async (b) => {
    const room = getRoom(b.code, b.pid);
    if (room.phase !== 'voting') throw httpErr(400, 'Voting isn\'t open.');
    const p = room.pickById[b.target]; if (!p) throw httpErr(400, 'That song isn\'t in this round.');
    if (p.author === b.pid) throw httpErr(400, 'You can\'t vote for your own song.');
    room.votes[b.pid] = b.target;                           // one vote per player; changing it replaces the old one
    maybeFinish(room); touch(room); return { ok: true };
  },
};

async function handle(req) {
  const url = new URL(req.url, 'http://x'); const key = req.method + ' ' + url.pathname; const q = url.searchParams;
  limit('global', req);
  if (key === 'GET /api/state') {
    const code = q.get('code'), pid = q.get('pid');
    if (!CODE_RE.test(String(code)) || !PID_RE.test(String(pid))) throw httpErr(400, 'Bad request.');
    const room = getRoom(code, pid);
    if (Number(q.get('v')) === room.v) return { unchanged: true, t: Date.now() };
    return viewFor(room, pid);
  }
  if (key === 'GET /api/room') {
    const code = String(q.get('code') || '').toUpperCase();
    const room = CODE_RE.test(code) && rooms.get(code);
    return room ? { exists: true, players: Object.keys(room.players).length, phase: room.phase, full: Object.keys(room.players).length >= MAX_PLAYERS } : { exists: false };
  }
  if (key === 'GET /api/config') return { search: HAS_SEARCH, library: library.meta() };
  if (key === 'GET /api/library') {
    limit('library', req);
    const type = ['video', 'image', 'text'].includes(q.get('type')) ? q.get('type') : 'text';
    return library.list(type, String(q.get('mood') || '').slice(0, 20) || null, 12);
  }
  if (key === 'GET /api/search') {
    limit('search', req);
    if (!HAS_SEARCH) throw httpErr(501, 'Song search isn\'t set up on this server. Paste a Spotify song link instead.');
    const term = String(q.get('q') || '').slice(0, 100).trim(); if (!term) return [];
    try { return await search(term); } catch { throw httpErr(502, 'Spotify search is unavailable right now. You can paste a song link instead.'); }
  }
  const fn = routes[key]; if (!fn) throw httpErr(404, 'Not found');
  let raw = '', size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw httpErr(413, 'That upload is too large.'); raw += chunk; }
  let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { throw httpErr(400, 'Bad request.'); }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw httpErr(400, 'Bad request.');
  if (body.code !== undefined) body.code = String(body.code).toUpperCase();
  if (body.pid !== undefined && !PID_RE.test(String(body.pid)) && key !== 'POST /api/create' && key !== 'POST /api/join') throw httpErr(400, 'Bad request.');
  return fn(body, req);
}

const PUBLIC = path.join(__dirname, 'public');
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/config.js': ['config.js', 'text/javascript; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'] };
const ALLOWED = new Set(['capacitor://localhost', 'ionic://localhost', 'https://localhost', ...(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; frame-src https://open.spotify.com https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'");
  const origin = req.headers.origin;
  if (origin && ALLOWED.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (req.url.startsWith('/api/')) {
    try {
      const out = await handle(req);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(out));
    } catch (e) {
      const headers = { 'Content-Type': 'application/json' }; if (e.retry) headers['Retry-After'] = String(e.retry);
      if (!e.status) console.error('[error]', e);
      res.writeHead(e.status || 500, headers); res.end(JSON.stringify({ error: e.status ? e.message : 'Something went wrong on our side. Please try again.' }));
    }
    return;
  }
  const media = /^\/media\/([a-z0-9-]+\.jpg)$/.exec(req.url.split('?')[0]);
  if (media) {
    fs.readFile(library.mediaPath(media[1]), (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }); res.end(data);
    });
    return;
  }
  const hit = STATIC[req.url.split('?')[0]] || STATIC['/'];       // unknown paths and invite links (?join=CODE) load the app
  fs.readFile(path.join(PUBLIC, hit[0]), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Missing file'); }
    res.writeHead(200, { 'Content-Type': hit[1], 'Cache-Control': 'no-cache' }); res.end(data);
  });
});

/* background upkeep: host handover, drop long-gone players, expire idle rooms */
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (now - room.active > ROOM_IDLE_MS) { rooms.delete(room.code); continue; }
    for (const [pid, p] of Object.entries(room.players)) if (now - p.lastSeen > PLAYER_DROP_MS) removePlayer(room, pid);
    const host = room.players[room.hostId];
    if (host && now - host.lastSeen > HOST_AWAY_MS) { const n = nextHost(room); if (n && n !== room.hostId && isOnline(room.players[n])) { room.hostId = n; touch(room); } }
  }
}, 15000).unref();

library.init().catch((e) => console.warn('[library] init failed:', e.message));
if (require.main === module) server.listen(PORT, () => console.log(`Score It running on http://localhost:${PORT}  (Spotify search: ${HAS_SEARCH ? 'on' : 'off - paste links'})`));
module.exports = { server, rooms };
