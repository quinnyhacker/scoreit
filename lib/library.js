'use strict';
/*
 * Built-in scene library.
 *
 * - Written prompts: original, always available.
 * - Videos / images: curated by FIXED search queries per mood, fetched server-side from Pexels and/or
 *   Pixabay with keys from the environment (never sent to the browser), normalized with creator +
 *   license + source metadata, and cached for 24 hours (Pixabay requires 24h caching; this also keeps
 *   us far below both providers' rate limits: ~24 API calls per provider per day).
 * - Pexels: media is hotlinked from the Pexels CDN as returned by the API; a prominent Pexels link and
 *   creator credit are shown in the app.
 * - Pixabay: images are downloaded to our own cache (permanent hotlinking of Pixabay images is not
 *   allowed); videos are embedded from Pixabay's CDN, which its API docs permit.
 * - Nothing is fetched during gameplay; rounds only read the cache.
 * Set LIBRARY_BLOCKLIST=id1,id2 to remove specific items after a human review.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WRITTEN = require('./written-scenes');

const PEXELS_BASE = process.env.PEXELS_API_BASE || 'https://api.pexels.com';
const PIXABAY_BASE = process.env.PIXABAY_API_BASE || 'https://pixabay.com/api';
const TTL = 24 * 3600 * 1000;
const MAX_CLIP_SECONDS = 25;
const PER_MOOD = 10;
const CACHE_DIR = process.env.LIBRARY_CACHE_DIR || path.join(os.tmpdir(), 'scoreit-cache');
const MEDIA_DIR = path.join(CACHE_DIR, 'media');
const CACHE_FILE = path.join(CACHE_DIR, 'library.json');
const BLOCK = new Set((process.env.LIBRARY_BLOCKLIST || '').split(',').map((s) => s.trim()).filter(Boolean));

const MEDIA_MOODS = [
  { id: 'epic', label: 'Epic' }, { id: 'action', label: 'Action' }, { id: 'emotional', label: 'Emotional' },
  { id: 'nature', label: 'Nature' }, { id: 'funny', label: 'Funny' }, { id: 'mystery', label: 'Mysterious' },
];
// Curation = a reviewed list of queries (two per mood). Change here, not at runtime.
const QUERIES = {
  video: { epic: ['cinematic mountains', 'city skyline timelapse'], action: ['skateboarding', 'car racing'], emotional: ['rain on window', 'sunset silhouette'],
    nature: ['ocean waves', 'forest fog'], funny: ['funny dog', 'cat playing'], mystery: ['dark forest night', 'foggy road'] },
  image: { epic: ['dramatic landscape', 'cinematic sunset'], action: ['parkour jump', 'surfing wave'], emotional: ['lonely bench', 'rain window'],
    nature: ['aurora', 'waterfall'], funny: ['funny pets', 'silly dog'], mystery: ['foggy forest', 'abandoned building'] },
};
const PEXELS_LICENSE = { name: 'Pexels License', url: 'https://www.pexels.com/license/' };
const PIXABAY_LICENSE = { name: 'Pixabay Content License', url: 'https://pixabay.com/service/license-summary/' };

let items = [...WRITTEN.ITEMS];       // written prompts always present
let status = { pexels: 'off', pixabay: 'off', updated: 0, refreshing: false };
const hasPexels = () => !!process.env.PEXELS_API_KEY;
const hasPixabay = () => !!process.env.PIXABAY_API_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

/* ---------- Pexels ---------- */
async function pexels(p) {
  const r = await fetch(PEXELS_BASE + p, { headers: { Authorization: process.env.PEXELS_API_KEY }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('pexels ' + r.status);
  return r.json();
}
async function fromPexels(type, mood, q) {
  const enc = encodeURIComponent(q);
  if (type === 'video') {
    const j = await pexels(`/videos/search?query=${enc}&per_page=8&orientation=landscape&size=medium`);
    return (j.videos || []).map((v) => {
      const f = (v.video_files || []).filter((x) => x.file_type === 'video/mp4' && x.width && x.width <= 1280 && x.width >= 640).sort((a, b) => b.width - a.width)[0];
      if (!f || !v.duration || v.duration > MAX_CLIP_SECONDS) return null;
      return { id: `px-v-${v.id}`, kind: 'video', mood, url: f.link, poster: v.image, thumb: v.image, duration: v.duration, width: f.width, height: f.height,
        credit: { name: (v.user || {}).name || 'Pexels', url: v.url, source: 'Pexels' }, license: PEXELS_LICENSE };
    }).filter(Boolean);
  }
  const j = await pexels(`/v1/search?query=${enc}&per_page=8&orientation=landscape`);
  return (j.photos || []).map((p) => ({ id: `px-i-${p.id}`, kind: 'image', mood, url: p.src.large, thumb: p.src.medium, alt: p.alt || '',
    credit: { name: p.photographer, url: p.url, source: 'Pexels' }, license: PEXELS_LICENSE }));
}

/* ---------- Pixabay ---------- */
async function pixabayCall(type, q) {
  const key = encodeURIComponent(process.env.PIXABAY_API_KEY);
  const url = type === 'video' ? `${PIXABAY_BASE}/videos/?key=${key}&q=${encodeURIComponent(q)}&per_page=8&safesearch=true`
    : `${PIXABAY_BASE}/?key=${key}&q=${encodeURIComponent(q)}&image_type=photo&orientation=horizontal&per_page=8&safesearch=true`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('pixabay ' + r.status);
  return r.json();
}
async function downloadImage(url, id) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok || !/^image\/jpeg/.test(r.headers.get('content-type') || '')) throw new Error('bad image');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 3 * 1024 * 1024) throw new Error('image too large');
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, id + '.jpg'), buf);
  return `/media/${id}.jpg`;
}
async function fromPixabay(type, mood, q) {
  const j = await pixabayCall(type, q);
  const out = [];
  for (const h of j.hits || []) {
    const credit = { name: h.user || 'Pixabay', url: h.pageURL, source: 'Pixabay' };
    if (type === 'video') {
      const v = h.videos || {}; const f = [v.small, v.medium, v.tiny].find((x) => x && x.url && x.width && x.width <= 1280 && x.width >= 640 && x.width > x.height);
      if (!f || !h.duration || h.duration > MAX_CLIP_SECONDS) continue;
      out.push({ id: `pb-v-${h.id}`, kind: 'video', mood, url: f.url, poster: f.thumbnail || '', thumb: f.thumbnail || '', duration: h.duration, width: f.width, height: f.height, credit, license: PIXABAY_LICENSE });
    } else {
      const id = `pb-i-${h.id}`;
      try { const local = await downloadImage(h.largeImageURL || h.webformatURL, id); out.push({ id, kind: 'image', mood, url: local, thumb: local, alt: h.tags || '', credit, license: PIXABAY_LICENSE }); }
      catch { /* skip images we cannot store */ }
    }
  }
  return out;
}

/* ---------- refresh + cache ---------- */
async function collect(name, fn) {
  const found = [];
  for (const type of ['video', 'image']) for (const m of MEDIA_MOODS) for (const q of QUERIES[type][m.id]) {
    try { found.push(...await fn(type, m.id, q)); } catch (e) { if (/ 40[13]| 429/.test(String(e.message))) { console.warn(`[library] ${name} refused: ${e.message}`); return { found, ok: false }; } }
    await sleep(250);
  }
  return { found, ok: true };
}
async function refresh() {
  if (status.refreshing) return; status.refreshing = true;
  try {
    const media = [];
    if (hasPexels()) { const r = await collect('pexels', fromPexels); media.push(...r.found); status.pexels = r.ok ? 'ok' : 'error'; }
    if (hasPixabay()) { const r = await collect('pixabay', fromPixabay); media.push(...r.found); status.pixabay = r.ok ? 'ok' : 'error'; }
    if (media.length) {
      const seen = new Set(); const kept = []; const count = {};
      for (const it of shuffle(media)) {
        if (BLOCK.has(it.id) || seen.has(it.id)) continue; seen.add(it.id);
        const k = it.kind + it.mood; count[k] = (count[k] || 0) + 1; if (count[k] > PER_MOOD) continue; kept.push(it);
      }
      items = [...WRITTEN.ITEMS, ...kept]; status.updated = Date.now();
      try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify({ updated: status.updated, items: kept })); } catch { /* cache is optional */ }
      console.log(`[library] ${kept.length} media scenes ready (+${WRITTEN.ITEMS.length} written)`);
    } else if (hasPexels() || hasPixabay()) console.warn('[library] no media returned; keeping previous library');
  } finally { status.refreshing = false; }
}
async function init() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const intact = c.items.every((i) => !i.url.startsWith('/media/') || fs.existsSync(path.join(MEDIA_DIR, i.url.slice(7))));
    if (Date.now() - c.updated < TTL && intact && (hasPexels() || hasPixabay())) { items = [...WRITTEN.ITEMS, ...c.items.filter((i) => !BLOCK.has(i.id))]; status.updated = c.updated; return; }
  } catch { /* no cache */ }
  if (hasPexels() || hasPixabay()) refresh().catch((e) => console.warn('[library] refresh failed:', e.message));
  setInterval(() => refresh().catch(() => {}), TTL).unref();
}

/* ---------- queries ---------- */
const count = (kind) => items.filter((i) => i.kind === kind).length;
function meta() {
  const m = (kind, moods) => moods.map((x) => ({ ...x, count: items.filter((i) => i.kind === kind && i.mood === x.id).length })).filter((x) => x.count);
  return { available: { video: count('video'), image: count('image'), text: count('text') },
    moods: { video: m('video', MEDIA_MOODS), image: m('image', MEDIA_MOODS), text: m('text', WRITTEN.MOODS) },
    providers: { pexels: hasPexels(), pixabay: hasPixabay() }, updated: status.updated };
}
const pub = (i) => ({ id: i.id, kind: i.kind, mood: i.mood, thumb: i.thumb || null, duration: i.duration || null, caption: i.caption || null, alt: i.alt || '',
  credit: i.credit ? { name: i.credit.name, source: i.credit.source } : null });
function list(type, mood, limit = 18) {
  const pool = items.filter((i) => i.kind === type && (!mood || i.mood === mood));
  return shuffle(pool).slice(0, limit).map(pub);
}
const get = (id) => items.find((i) => i.id === id) || null;
function random(type, used) {
  const kinds = type && type !== 'any' ? [type] : ['video', 'image', 'text'].filter((k) => count(k));
  const kind = kinds[crypto.randomInt(kinds.length)];
  const pool = items.filter((i) => i.kind === kind); const fresh = pool.filter((i) => !used.has(i.id));
  const src = fresh.length ? fresh : pool; return src[crypto.randomInt(src.length)] || null;
}
// Scene object stored in a room (server-built, so credits/licenses cannot be forged by a client).
const httpsOnly = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '');
function toScene(i) {
  return { kind: i.kind, url: i.url || null, poster: i.poster || '', caption: i.caption || '', libraryId: i.id, mood: i.mood, duration: i.duration || null,
    credit: i.credit && httpsOnly(i.credit.url) ? { name: String(i.credit.name || '').slice(0, 60), url: httpsOnly(i.credit.url), source: i.credit.source } : null, license: i.license || null };
}
const mediaPath = (file) => path.join(MEDIA_DIR, file);
module.exports = { init, refresh, meta, list, get, random, toScene, mediaPath, status: () => status };
