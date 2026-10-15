// Score It - zero-dependency Node server. In-memory rooms; state is lost on restart.
// Optional Spotify search: set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in the environment
// (in production, source these from Azure Key Vault - never commit them).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HAS_SEARCH = !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
const rooms = new Map();
const MAX_BODY = 3 * 1024 * 1024;
const ROOM_TTL = 6 * 3600 * 1000;

const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const cleanName = (s) => String(s || '').trim().replace(/[<>]/g, '').slice(0, 20);

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += chars[crypto.randomInt(chars.length)];
    if (!rooms.has(c)) return c;
  }
}

function touch(room) { room.v++; room.updated = Date.now(); }

// ---------- Spotify helpers ----------
const TRACK_RE = /(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/;
const parseTrackId = (s) => { const m = TRACK_RE.exec(String(s || '')); return m ? m[1] : null; };

async function trackMeta(id) {
  try {
    const r = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent('https://open.spotify.com/track/' + id),
      { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const j = await r.json(); return { title: String(j.title || 'Unknown track').slice(0, 120), thumb: j.thumbnail_url || '' }; }
  } catch { /* fall through */ }
  return { title: 'Spotify track', thumb: '' };
}

let tokenCache = { token: null, exp: 0 };
async function spotifyToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const basic = Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error('token');
  const j = await r.json();
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return tokenCache.token;
}

async function search(q) {
  const token = await spotifyToken();
  const r = await fetch('https://api.spotify.com/v1/search?type=track&limit=8&q=' + encodeURIComponent(q),
    { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('search');
  const j = await r.json();
  return j.tracks.items.map((t) => ({
    id: t.id, title: t.name, artist: t.artists.map((a) => a.name).join(', '),
    thumb: (t.album.images[t.album.images.length - 1] || {}).url || '',
  }));
}

// ---------- State views ----------
function viewFor(room, pid) {
  const me = room.players[pid];
  const players = Object.entries(room.players).map(([id, p]) => ({
    id, name: p.name, score: p.score, isHost: id === room.hostId,
    picked: !!room.picks[id], voted: !!room.votes[id],
  }));
  const out = {
    v: room.v, code: room.code, phase: room.phase, round: room.round, scene: room.scene,
    me: { id: pid, name: me.name, isHost: pid === room.hostId }, players, picks: [], myPick: null, myVote: room.votes[pid] || null,
  };
  const mine = room.picks[pid];
  if (mine) out.myPick = { title: mine.title, trackId: mine.trackId };
  if (room.phase === 'voting') {
    out.picks = room.order.map((id) => {
      const p = room.pickById[id];
      return { id, trackId: p.trackId, title: p.title, thumb: p.thumb, mine: p.author === pid };
    });
  } else if (room.phase === 'results') {
    out.picks = room.order.map((id) => {
      const p = room.pickById[id];
      const voters = Object.entries(room.votes).filter(([, t]) => t === id).map(([v]) => room.players[v].name);
      return { id, trackId: p.trackId, title: p.title, thumb: p.thumb, mine: p.author === pid,
        author: room.players[p.author].name, voters };
    }).sort((a, b) => b.voters.length - a.voters.length);
  }
  return out;
}

function beginVoting(room) {
  room.phase = 'voting';
  room.pickById = {};
  for (const [author, p] of Object.entries(room.picks)) room.pickById[rid(3)] = { ...p, author };
  room.order = Object.keys(room.pickById).sort(() => crypto.randomInt(3) - 1);
  room.votes = {};
}

function finishRound(room) {
  for (const t of Object.values(room.votes)) {
    const p = room.pickById[t];
    if (p && room.players[p.author]) room.players[p.author].score += 100;
  }
  room.phase = 'results';
}

// ---------- API ----------
function need(room, pid) { if (!room || !room.players[pid]) throw httpErr(404, 'Room or player not found'); }
function httpErr(code, msg) { const e = new Error(msg); e.status = code; return e; }
function hostOnly(room, pid) { if (pid !== room.hostId) throw httpErr(403, 'Host only'); }

function validScene(s) {
  if (!s || typeof s !== 'object') throw httpErr(400, 'Bad scene');
  const caption = String(s.caption || '').trim().slice(0, 200);
  if (s.kind === 'text') {
    if (!caption) throw httpErr(400, 'Describe the scene');
    return { kind: 'text', caption };
  }
  if (s.kind === 'image') {
    const url = String(s.url || '');
    const ok = /^https:\/\/[^\s"'<>]+$/i.test(url) || /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(url);
    if (!ok) throw httpErr(400, 'Image must be an https URL or an uploaded png/jpeg/gif/webp');
    return { kind: 'image', url, caption };
  }
  throw httpErr(400, 'Bad scene');
}

const routes = {
  'POST /api/create': async (b) => {
    const name = cleanName(b.name); if (!name) throw httpErr(400, 'Enter a name');
    const code = newCode(), pid = rid();
    rooms.set(code, { code, v: 1, updated: Date.now(), hostId: pid, phase: 'setup', round: 0, scene: null,
      players: { [pid]: { name, score: 0 } }, picks: {}, votes: {}, pickById: {}, order: [] });
    return { code, pid };
  },
  'POST /api/join': async (b) => {
    const room = rooms.get(String(b.code || '').toUpperCase());
    const name = cleanName(b.name);
    if (!room) throw httpErr(404, 'No such room');
    if (!name) throw httpErr(400, 'Enter a name');
    if (Object.keys(room.players).length >= 12) throw httpErr(400, 'Room is full');
    if (Object.values(room.players).some((p) => p.name.toLowerCase() === name.toLowerCase())) throw httpErr(400, 'Name already taken');
    const pid = rid(); room.players[pid] = { name, score: 0 }; touch(room);
    return { code: room.code, pid };
  },
  'POST /api/scene': async (b) => {
    const room = rooms.get(b.code); need(room, b.pid); hostOnly(room, b.pid);
    if (room.phase !== 'setup' && room.phase !== 'results') throw httpErr(400, 'Round in progress');
    room.scene = validScene(b.scene); room.phase = 'picking'; room.round++;
    room.picks = {}; room.votes = {}; room.pickById = {}; room.order = []; touch(room);
    return { ok: true };
  },
  'POST /api/pick': async (b) => {
    const room = rooms.get(b.code); need(room, b.pid);
    if (room.phase !== 'picking') throw httpErr(400, 'Not accepting picks');
    const id = parseTrackId(b.url || ('spotify:track:' + b.trackId));
    if (!id) throw httpErr(400, 'Paste a Spotify track link');
    const meta = await trackMeta(id);
    if (b.title) meta.title = String(b.title).slice(0, 120);
    room.picks[b.pid] = { trackId: id, ...meta }; touch(room);
    return { ok: true };
  },
  'POST /api/phase': async (b) => {
    const room = rooms.get(b.code); need(room, b.pid); hostOnly(room, b.pid);
    if (b.to === 'voting' && room.phase === 'picking') {
      if (!Object.keys(room.picks).length) throw httpErr(400, 'No picks yet');
      beginVoting(room);
    } else if (b.to === 'results' && room.phase === 'voting') finishRound(room);
    else throw httpErr(400, 'Invalid transition');
    touch(room); return { ok: true };
  },
  'POST /api/vote': async (b) => {
    const room = rooms.get(b.code); need(room, b.pid);
    if (room.phase !== 'voting') throw httpErr(400, 'Not voting');
    const p = room.pickById[b.target];
    if (!p) throw httpErr(400, 'Bad pick');
    if (p.author === b.pid) throw httpErr(400, "You can't vote for your own song");
    room.votes[b.pid] = b.target;
    // A player can vote only if some pick isn't theirs; auto-finish once all eligible voters have voted.
    const canVote = (id) => Object.keys(room.picks).some((a) => a !== id);
    if (Object.keys(room.players).filter(canVote).every((id) => room.votes[id])) finishRound(room);
    touch(room); return { ok: true };
  },
};

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;

  if (key === 'GET /api/state') {
    const room = rooms.get(url.searchParams.get('code'));
    const pid = url.searchParams.get('pid');
    need(room, pid);
    if (Number(url.searchParams.get('v')) === room.v) return { unchanged: true };
    return viewFor(room, pid);
  }
  if (key === 'GET /api/config') return { search: HAS_SEARCH };
  if (key === 'GET /api/search') {
    if (!HAS_SEARCH) throw httpErr(501, 'Search not configured');
    const q = String(url.searchParams.get('q') || '').slice(0, 100);
    if (!q) return [];
    try { return await search(q); } catch { throw httpErr(502, 'Spotify search failed'); }
  }
  const fn = routes[key];
  if (!fn) throw httpErr(404, 'Not found');
  let raw = '', size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw httpErr(413, 'Too large'); raw += chunk; }
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { throw httpErr(400, 'Bad JSON'); }
  if (body.code) body.code = String(body.code).toUpperCase();
  return fn(body);
}

const PUBLIC = path.join(__dirname, 'public');
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/config.js': ['config.js', 'text/javascript; charset=utf-8'] };
// Origins the native iOS app (Capacitor) sends. Extend with ALLOWED_ORIGINS="https://a,https://b".
const ALLOWED = new Set(['capacitor://localhost', 'ionic://localhost', 'https://localhost',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);

http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: data:; frame-src https://open.spotify.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");
  const origin = req.headers.origin;
  if (origin && ALLOWED.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (req.url.startsWith('/api/')) {
    try {
      const out = await handle(req, res);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(e.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.status ? e.message : 'Server error' }));
    }
    return;
  }
  const hit = STATIC[req.url.split('?')[0]] || STATIC['/'];
  fs.readFile(path.join(PUBLIC, hit[0]), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Missing file'); }
    res.writeHead(200, { 'Content-Type': hit[1] });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Score It running on http://localhost:${PORT}  (Spotify search: ${HAS_SEARCH ? 'on' : 'off - paste links'})`));

setInterval(() => { for (const [c, r] of rooms) if (Date.now() - r.updated > ROOM_TTL) rooms.delete(c); }, 600000).unref();
