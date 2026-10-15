'use strict';
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const SERVER = window.SCOREIT_SERVER || '';
const TONES = ['#d4a97f', '#93bba6', '#8fa9cf', '#b9a0cf', '#cf94a4', '#cdc482', '#82cdc4', '#cf9575'];
const tone = (s) => TONES[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
const PROVIDERS = { Pexels: 'https://www.pexels.com', Pixabay: 'https://pixabay.com' };

/* ---------- icons: one family, 24px grid, 1.6 stroke ---------- */
const PATHS = {
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>', play:'<path d="M8 5.5v13l10.5-6.5z"/>', search:'<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  upload:'<path d="M12 16V5"/><path d="M7.5 9.5L12 5l4.5 4.5"/><path d="M5 19h14"/>', type:'<path d="M5 6h14"/><path d="M12 6v13"/><path d="M9 19h6"/>',
  leave:'<path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10"/><path d="M15 8l4 4-4 4"/><path d="M19 12H9.5"/>',
  copy:'<rect x="9" y="9" width="10" height="10" rx="2"/><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15"/>',
  shuffle:'<path d="M4 7h3c3 0 4 10 8 10h5"/><path d="M4 17h3c1.5 0 2.5-1.5 3.5-3"/><path d="M15 7h5"/><path d="M18 4.5L20.5 7 18 9.5"/><path d="M18 14.5l2.5 2.5-2.5 2.5"/>',
  image:'<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.4"/><path d="M20 16l-4.5-4.5L7 19"/>',
  film:'<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 5v14M15 5v14M4 10h5M15 10h5M4 14h5M15 14h5"/>',
  plus:'<path d="M12 5v14"/><path d="M5 12h14"/>', left:'<path d="M14.5 6L8.5 12l6 6"/>', right:'<path d="M9.5 6l6 6-6 6"/>', back:'<path d="M14.5 6L8.5 12l6 6"/>',
  star:'<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z"/>', music:'<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  share:'<path d="M12 4v11"/><path d="M8 8l4-4 4 4"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/>', close:'<path d="M6 6l12 12M18 6L6 18"/>',
  external:'<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V9a1.5 1.5 0 0 1 1.5-1.5H10"/>',
};
const icon = (n, cls = '') => `<svg class="i ${n === 'play' ? 'fill' : ''} ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[n]}</svg>`;
const MARK = `<svg class="mark" viewBox="0 0 56 36" aria-hidden="true"><rect class="frame" x=".75" y=".75" width="54.5" height="34.5" rx="6"/>
  <rect class="bar" x="12" y="11" width="3.5" height="14" rx="1.75"/><rect class="bar" x="19.5" y="7" width="3.5" height="22" rx="1.75"/><rect class="bar" x="27" y="9" width="3.5" height="18" rx="1.75"/>
  <rect class="bar" x="34.5" y="5" width="3.5" height="26" rx="1.75"/><rect class="bar" x="42" y="12" width="3.5" height="12" rx="1.75"/></svg>`;

/* ---------- storage: survives refresh, closed tabs and reconnects ---------- */
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };
let session = store.get('scoreit.session');
const inviteCode = (new URLSearchParams(location.search).get('join') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
if (inviteCode.length === 4 && session && session.code !== inviteCode) { session = null; store.del('scoreit.session'); }   // a new invite link wins over an old game

let state = null, cfg = { search:false, library:{ available:{ video:0, image:0, text:0 }, moods:{ video:[], image:[], text:[] } } };
const ui = { err:'', notice:'', tab:null, mood:null, lib:{}, libLoading:false, sel:null, pickTab:null, hits:null, name: store.get('scoreit.name') || '', code: inviteCode, cap:'', url:'', sq:'', link:'', text:'',
  chooser:false, changing:false, cur:0, open:{}, invite: inviteCode.length === 4 ? { code: inviteCode, status:'checking' } : null, searching:false };
let leaveArmed = false; const last = {}; let inRoom = false, lastPhaseKey = '', lastBase = ''; const scoreMemo = {}; const locks = new Set(); let fails = 0;

async function api(path, body) {
  const opt = body ? { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ ...body, ...(session || {}) }) } : {};
  let r; try { r = await fetch(SERVER + '/api/' + path, opt); } catch { const e = new Error('Can\'t reach the game right now. Check your connection.'); e.network = true; throw e; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
  return j;
}
const setErr = (m) => { ui.err = m || ''; const el = document.getElementById('err'); if (el) el.textContent = ui.err; };
// one request per action at a time: no accidental double submits
const act = async (path, body) => {
  const key = path + (body && body.to ? ':' + body.to : ''); if (locks.has(key)) return; locks.add(key);
  try { const r = await api(path, body); setErr(''); await poll(true); return r; } catch (e) { setErr(e.message); } finally { locks.delete(key); }
};
const save = (s) => { session = s; store.set('scoreit.session', s); };
function toast(msg) { const el = document.getElementById('toast'); if (!el) return; el.textContent = msg; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); }
function leave(notice) {
  store.del('scoreit.session'); session = null; state = null; inRoom = false; lastPhaseKey = ''; lastBase = ''; fails = 0; setNet(true);
  Object.keys(last).forEach((k) => delete last[k]); document.body.dataset.phase = 'home'; ui.notice = notice || ''; ui.chooser = false; history.replaceState(null, '', location.pathname); render();
}
function setNet(ok) { const el = document.getElementById('net'); if (el) el.classList.toggle('on', !ok); }

async function poll(force) {
  if (!session) return;
  try {
    const s = await api(`state?code=${session.code}&pid=${session.pid}&v=${force ? 0 : (state?.v ?? 0)}`);
    fails = 0; setNet(true);
    if (!s.unchanged) { state = s; render(); }
  } catch (e) {
    if (e.status === 404) return leave(e.message);
    if (e.network || e.status >= 500) { fails++; if (fails >= 2) setNet(false); }
  }
}
setInterval(() => poll(false), 1500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(true); });      // refresh instantly when a phone wakes up
window.addEventListener('online', () => poll(true));

/* only touch the DOM when HTML changed; never replace a section while the user types in it */
function setSection(id, html, animateKey, force) {
  const el = document.getElementById(id); if (!el) return;
  if (last[id] === html && !force) return;
  const a = document.activeElement;
  if (!force && last[id + ':k'] === animateKey && a && el.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
  const fresh = last[id] === undefined || last[id + ':k'] !== animateKey;
  last[id] = html; last[id + ':k'] = animateKey;
  el.innerHTML = html;
  if (fresh) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
}

/* ---------- shared pieces ---------- */
const pad = (n) => String(n).padStart(2, '0');
const mediaUrl = (u) => (u && u.startsWith('/') ? SERVER + u : u || '');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const splitTitle = (t) => { const [a, ...b] = String(t || '').split(' — '); return { title: a || 'Spotify track', artist: b.join(' — ') }; };
const avatar = (p, sz = 40, done = false) => `<span class="av ${done ? 'done' : ''} ${p.online === false ? 'off' : ''}" style="--sz:${sz}px;--tone:${tone(p.name)}" ${p.online === false ? 'title="Offline"' : ''}>${esc((p.name[0] || '?').toUpperCase())}${p.isHost ? `<span class="host" title="Host">${icon('star')}</span>` : ''}</span>`;
const art = (src, sz) => src ? `<img class="art" style="--sz:${sz}px" src="${esc(src)}" alt="" loading="lazy" decoding="async">` : `<span class="art" style="--sz:${sz}px;display:grid;place-items:center;color:var(--faint)">${icon('music')}</span>`;
const embed = (id, h) => `<iframe ${h ? 'data-src' : 'src'}="https://open.spotify.com/embed/track/${esc(id)}?utm_source=generator&theme=0" allow="encrypted-media; clipboard-write" ${h ? '' : 'loading="lazy"'} title="Spotify player"></iframe>`;
const waitHtml = (msg) => `<div class="wait"><span>${msg}</span></div>`;
const lead = (t) => `<p class="lead">${t}</p>`;
function stepsHtml(active) {
  const names = ['Pick', 'Vote', 'Results']; const i = names.indexOf(active);
  return `<ol class="steps">${names.map((n, k) => `<li class="${k === i ? 'on' : k < i ? 'done' : ''}">${n}</li>`).join('')}</ol>`;
}
const isLobby = () => state.phase === 'setup' && state.round === 0 && !ui.chooser;
const hostName = () => (state.players.find((p) => p.isHost) || {}).name || 'the host';
const inviteUrl = () => `${SERVER || location.origin}/?join=${state.code}`;
const creditHtml = (s) => {
  if (!s.credit) return '';
  const what = s.kind === 'video' ? 'Video' : 'Photo', prov = PROVIDERS[s.credit.source];
  return `<small class="credit">${what} by <a href="${esc(s.credit.url)}" target="_blank" rel="noopener noreferrer">${esc(s.credit.name)}</a> on <a href="${esc(prov || s.credit.url)}" target="_blank" rel="noopener noreferrer">${esc(s.credit.source)}</a></small>`;
};

/* ---------- scene ---------- */
function sceneMedia(s) {
  if (s.kind === 'text') return `<div class="stage text"><p>${esc(s.caption)}</p></div>`;
  let media = '';
  if (s.kind === 'image') media = `<img class="bg" src="${esc(mediaUrl(s.url))}" alt="" decoding="async"><img class="fg" src="${esc(mediaUrl(s.url))}" alt="${esc(s.caption || 'Scene to score')}" referrerpolicy="no-referrer" decoding="async">`;
  else if (s.kind === 'video') media = `<video src="${esc(mediaUrl(s.url))}" poster="${esc(mediaUrl(s.poster))}" autoplay muted loop playsinline controls preload="metadata" aria-label="Scene video"></video>`;
  else if (s.kind === 'youtube') media = `<iframe src="https://www.youtube-nocookie.com/embed/${esc(s.id)}?rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Scene video"></iframe>`;
  return `<div class="stage">${media}</div>`;
}
function stageHtml() {
  const s = state.scene;
  if (!s) return `<div class="stage text empty"><p>${icon('image')}Choose a scene to begin</p></div>`;
  const credit = creditHtml(s);
  return `<div class="scene-label"><span class="label">Scene ${pad(state.round)}</span></div>${sceneMedia(s)}
    ${(s.kind !== 'text' && s.caption) || credit ? `<div class="scene-meta"><span class="cap">${s.kind === 'text' ? '' : esc(s.caption)}</span>${credit}</div>` : ''}`;
}
// If scene media fails to load, the game carries on with a clear message instead of a broken box
document.addEventListener('error', (e) => {
  const t = e.target; if (!t || !/^(IMG|VIDEO)$/.test(t.tagName)) return;
  const box = t.closest('.stage, .reveal .media'); if (!box || box.dataset.failed) return;
  if (t.classList.contains('bg')) return; box.dataset.failed = '1';
  box.innerHTML = `<div class="stage-fail">${icon('image')}<span>This scene couldn't load. You can still pick a song that fits the mood.</span></div>`;
}, true);

function showReveal(s, round) {
  const DUR = s.kind === 'video' || s.kind === 'youtube' ? 6000 : 4800;
  let media = '';
  if (s.kind === 'text') media = `<div class="media text"><p>${esc(s.caption)}</p></div>`;
  else if (s.kind === 'image') media = `<div class="media"><img src="${esc(mediaUrl(s.url))}" alt="" referrerpolicy="no-referrer"></div>`;
  else if (s.kind === 'video') media = `<div class="media"><video src="${esc(mediaUrl(s.url))}" poster="${esc(mediaUrl(s.poster))}" autoplay muted loop playsinline preload="auto"></video></div>`;
  else media = `<div class="media"><iframe src="https://www.youtube-nocookie.com/embed/${esc(s.id)}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1" allow="autoplay" title=""></iframe></div>`;
  const el = document.createElement('div'); el.className = 'reveal'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Scene ' + round);
  el.innerHTML = `${media}${s.kind === 'text' ? '' : '<div class="shade"></div>'}<span class="skip">Tap to continue</span>
    <div class="cap"><span class="label">Scene ${pad(round)}</span>${s.kind === 'text' ? '<div class="t sm">Pick the song that scores it</div>' : `<div class="t">${esc(s.caption || 'Pick the song that scores it')}</div>`}${s.credit ? `<div class="rc">${creditHtml(s)}</div>` : ''}</div>
    <div class="bar" style="--dur:${DUR}ms"></div>`;
  const close = () => { if (el.classList.contains('out')) return; el.classList.add('out'); setTimeout(() => el.remove(), 480); };
  el.addEventListener('click', (ev) => { if (!ev.target.closest('a')) close(); }); setTimeout(close, DUR);
  const box = document.getElementById('overlay'); box.textContent = ''; box.appendChild(el);
}

/* ---------- header + players ---------- */
function headHtml() {
  return `<div class="topbar"><span class="wordmark">${MARK.replace('class="mark"', 'class="mark" style="width:30px;height:20px"')}<span>Score It<i>.</i></span></span>
    <div style="display:flex;gap:var(--s2);align-items:center"><button class="code" data-act="copy" aria-label="Copy room code ${esc(state.code)}"><b>${esc(state.code)}</b>${icon('copy')}</button>
    <button class="iconbtn" data-act="leave" aria-label="Leave game">${icon('leave')}</button></div></div>`;
}
function stripHtml() {
  const doneKey = state.phase === 'picking' ? 'picked' : state.phase === 'voting' ? 'voted' : null;
  return `<h2 class="label" style="margin-bottom:var(--s4)">Players</h2><div class="strip">${state.players.map((p) =>
    `<span class="pl">${avatar(p, 36, doneKey && p[doneKey])}<span class="nm">${esc(p.name)}</span><span class="sc nums" data-pid="${esc(p.id)}" data-score="${p.score}">${p.score}</span></span>`).join('')}</div>`;
}

/* ---------- lobby ---------- */
function lobbyHtml() {
  const host = state.me.isHost, n = state.players.length;
  const roster = state.players.map((p) => `<div class="pl">${avatar(p, 64)}<span class="nm">${esc(p.name)}</span><span class="sub">${p.id === state.me.id ? 'You' : !p.online ? 'Offline' : p.isHost ? 'Host' : '&nbsp;'}</span></div>`).join('')
    + (n < 4 ? Array.from({ length: Math.min(2, 4 - n) }, () => `<div class="pl empty"><span class="av" style="--sz:64px">${icon('plus')}</span><span class="nm hint">Waiting</span></div>`).join('') : '');
  return `<div class="lobby-head"><span class="label">Room code</span>
    <button class="tiles" data-act="copy" style="background:none;border:0;padding:0;width:100%" aria-label="Room code ${esc(state.code)}. Tap to copy.">${[...state.code].map((c) => `<span>${esc(c)}</span>`).join('')}</button>
    <button class="btn block share" data-act="share">${icon('share')}Invite friends</button><p class="hint" style="margin-top:var(--s3)">Friends open the link, type a name, and they're in.</p></div>
    <div class="roster">${roster}</div>
    ${host ? `<div class="cta"><button class="btn primary block" data-act="start-game">Start game</button><p class="hint" style="text-align:center;margin-top:var(--s3)">${n} ${n === 1 ? 'player' : 'players'} in the lobby</p></div>`
      : waitHtml(`Waiting for ${esc(hostName())} to start the game`)}`;
}

/* ---------- scene library (host) ---------- */
const libAvail = () => cfg.library.available;
function libTabs() {
  const a = libAvail();
  return [...(a.video ? [['video', 'Videos', 'film']] : []), ...(a.image ? [['image', 'Images', 'image']] : []), ['text', 'Written', 'type'], ['custom', 'Custom', 'link']];
}
const curTab = () => { const t = libTabs(); return t.some((x) => x[0] === ui.tab) ? ui.tab : t[0][0]; };
const libKey = () => curTab() + '|' + (ui.mood || '');
function loadLibrary() {
  const type = curTab(); if (type === 'custom') return;
  const key = libKey(); if (ui.lib[key] || ui.libLoading) return;
  ui.libLoading = true; refreshAction();
  api(`library?type=${type}${ui.mood ? '&mood=' + ui.mood : ''}`).then((items) => { ui.lib[key] = items; setErr(''); }).catch((e) => { ui.lib[key] = []; setErr(e.message); })
    .finally(() => { ui.libLoading = false; refreshAction(); });
}
function selBar() {
  const s = ui.sel; if (!s) return '';
  const th = s.thumb ? `<img class="th" src="${esc(mediaUrl(s.thumb))}" alt="">` : `<div class="th">${icon(s.kind === 'text' ? 'type' : s.kind === 'youtube' ? 'play' : 'image')}</div>`;
  const label = s.kind === 'text' ? esc(String(s.caption || '').slice(0, 80)) : { image:'Image', video:'Video clip', youtube:'YouTube video' }[s.kind];
  return `<div class="selected">${th}<div style="flex:1;min-width:0" class="clamp1"><div>${label}</div><div class="hint">Selected</div></div><button class="btn ghost" data-act="clear-scene">Change</button></div>`;
}
function libGrid(type) {
  if (ui.libLoading && !ui.lib[libKey()]) return `<div class="${type === 'text' ? 'wlist' : 'grid'}">${Array.from({ length: type === 'text' ? 4 : 6 }, () => `<div class="skeleton ${type === 'text' ? 'wide' : ''}"></div>`).join('')}</div>`;
  const items = ui.lib[libKey()]; if (!items) return '';
  if (!items.length) return '<p class="hint">Nothing here yet. Try another mood.</p>';
  if (type === 'text') return `<div class="wlist">${items.map((it, i) => `<button class="wcard ${ui.sel && ui.sel.id === it.id ? 'sel' : ''}" data-act="pick-lib" data-i="${i}"><span class="mood">${esc(it.mood)}</span>${esc(it.caption)}</button>`).join('')}</div>`;
  return `<div class="grid">${items.map((it, i) => `<button class="tile ${ui.sel && ui.sel.id === it.id ? 'sel' : ''}" data-act="pick-lib" data-i="${i}" aria-label="${esc(it.kind === 'video' ? 'Video clip' : 'Image')}, ${esc(it.mood)}">
    <img src="${esc(mediaUrl(it.thumb))}" alt="${esc(it.alt || '')}" loading="lazy" decoding="async">${it.kind === 'video' ? `<span class="badge">${icon('play')}${it.duration ? mmss(it.duration) : ''}</span>` : ''}</button>`).join('')}</div>`;
}
function customPanel() {
  const t = ui.customTab || 'write';
  const tabs = [['write', 'Write', 'type'], ['link', 'Link', 'link'], ['upload', 'Upload', 'upload']];
  let body;
  if (t === 'link') body = `<div class="field"><input data-bind="url" value="${esc(ui.url)}" placeholder="Image, mp4 or YouTube link" aria-label="Scene link"><button class="btn" data-act="use-link">Use</button></div>`;
  else if (t === 'upload') body = `<input type="file" id="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Upload a photo"><p class="hint">Photos are resized automatically.</p>`;
  else body = `<textarea data-bind="text" rows="3" maxlength="200" placeholder="Describe your own scene" aria-label="Scene description">${esc(ui.text)}</textarea>`;
  return `<div class="seg">${tabs.map(([k, l]) => `<button class="${t === k ? 'on' : ''}" data-act="ctab" data-t="${k}">${l}</button>`).join('')}</div>${body}${ui.sel && !ui.sel.id && ui.sel.kind !== 'text' ? `<input data-bind="cap" value="${esc(ui.cap)}" maxlength="200" placeholder="Add a caption (optional)" aria-label="Caption">` : ''}`;
}
function setupHtml() {
  const tab = curTab(); const moods = tab === 'custom' ? [] : (cfg.library.moods[tab] || []);
  const canStart = !!(ui.sel || (tab === 'custom' && ui.text.trim()));
  return `<button class="btn ghost" style="padding-left:0;margin-bottom:var(--s3)" data-act="back">${icon('back')}${state.round === 0 ? 'Lobby' : 'Results'}</button>
    <h2 class="section-title">${state.round === 0 ? 'Pick the first scene' : 'Pick the next scene'}</h2>
    <button class="btn ${canStart ? '' : 'primary'} block random" data-act="random">${icon('shuffle')}Random scene</button>
    <p class="hint" style="text-align:center;margin:var(--s2) 0 var(--s5)">Starts right away with a surprise video, image or written prompt.</p>
    <div class="stack"><div class="tabs" role="tablist">${libTabs().map(([k, l, ic]) => `<button class="tab ${tab === k ? 'on' : ''}" role="tab" aria-selected="${tab === k}" data-act="tab" data-t="${k}">${icon(ic)}${l}</button>`).join('')}</div>
    ${moods.length ? `<div class="chips" role="group" aria-label="Filter by mood"><button class="chip ${!ui.mood ? 'on' : ''}" data-act="mood" data-m="">All</button>${moods.map((m) => `<button class="chip ${ui.mood === m.id ? 'on' : ''}" data-act="mood" data-m="${esc(m.id)}">${esc(m.label)}</button>`).join('')}<button class="chip shuf" data-act="reshuffle" aria-label="Show different scenes">${icon('shuffle')}</button></div>` : ''}
    ${tab === 'custom' ? customPanel() : libGrid(tab)}${selBar()}
    ${Object.values(libAvail()).some((n, i) => i < 2 && n) ? `<p class="hint attrib">Photos and videos from <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a> and <a href="https://pixabay.com" target="_blank" rel="noopener noreferrer">Pixabay</a>.</p>` : ''}</div>
    <div class="cta"><button class="btn primary block" data-act="start" ${canStart ? '' : 'disabled'}>Start with this scene</button></div>`;
}

/* ---------- song selection ---------- */
const hitsHtml = () => `<div class="results-list">${(ui.hits || []).map((h, i) => `<button class="song-row" style="animation-delay:${i * 30}ms" data-act="pick-song" data-id="${esc(h.id)}" data-title="${esc(h.title + ' — ' + h.artist)}">
  ${art(h.thumb, 52)}<span class="tx"><div>${esc(h.title)}</div><div class="hint">${esc(h.artist)}</div></span><span class="add">${icon('plus')}</span></button>`).join('')}${ui.sq.trim() && ui.hits && !ui.hits.length ? '<p class="hint">No songs found. Try another search.</p>' : ''}</div>`;
function lockedCard(my) {
  const t = splitTitle(my.title);
  return `<div class="locked-card">${art(my.thumb, 64)}<div class="tx"><div class="submitted">${icon('check')}Submitted</div><div class="t">${esc(t.title)}</div><div class="hint">${esc(t.artist || 'Spotify')}</div></div>
    <button class="btn ghost" data-act="change-pick">Change</button></div>`;
}
function pickingHtml() {
  const my = state.myPick, showInput = !my || ui.changing;
  const mode = ui.pickTab || (cfg.search ? 'search' : 'link');
  const tabs = cfg.search ? `<div class="tabs"><button class="tab ${mode === 'search' ? 'on' : ''}" data-act="ptab" data-t="search">Search Spotify</button><button class="tab ${mode === 'link' ? 'on' : ''}" data-act="ptab" data-t="link">Paste link</button></div>` : '';
  const input = mode === 'search' && cfg.search
    ? `<div class="searchbox">${icon('search')}<input data-bind="sq" value="${esc(ui.sq)}" placeholder="Search songs or artists" aria-label="Search Spotify" autocomplete="off" enterkeyhint="search"></div><div id="hits">${hitsHtml()}</div>`
    : `<div class="field"><input data-bind="link" value="${esc(ui.link)}" placeholder="Spotify song link" aria-label="Spotify song link"><button class="btn primary" data-act="submit-link">Lock in</button></div><p class="hint">In Spotify: ••• › Share › Copy Song Link</p>`;
  const picked = state.players.filter((p) => p.picked).length, total = state.players.length;
  return `${stepsHtml('Pick')}<h2 class="section-title">${my && !ui.changing ? 'Song locked in' : 'What plays under this scene?'}</h2>
    ${lead(my && !ui.changing ? `Nice pick. <span class="nums" data-count="picked"></span> picked so far.` : 'Choose the song that fits best. Everyone picks at the same time, and picks stay secret until voting.')}
    <div class="stack">${my ? lockedCard(my) : ''}${showInput ? (my ? `<p class="label">Choose a different song</p>` : '') + tabs + input : ''}</div>
    ${state.me.isHost ? `<div class="cta"><button class="btn primary block" data-act="tovote">Start voting<span class="count nums">&nbsp;· <span data-count="picked"></span> picked</span></button></div>`
      : waitHtml(`${picked === total ? 'Everyone has picked.' : 'Waiting for everyone to pick.'} The host starts voting.`)}`;
}

/* ---------- listening + voting: one song at a time ---------- */
function votingHtml() {
  const n = state.picks.length;
  const slides = state.picks.map((p, i) => `<div class="slide" data-id="${esc(p.id)}" data-track="${esc(p.trackId)}" data-mine="${p.mine ? 1 : 0}" data-i="${i}">${embed(p.trackId, true)}</div>`).join('');
  return `${stepsHtml('Vote')}<h2 class="section-title">Listen, then vote</h2>${lead("Play each song against the scene, then vote for the one that fits best. You can't vote for your own, and you can change your vote until results.")}
    <div class="pager"><span class="label nums">Song <span data-cur>1</span> of ${n}</span>
      <div style="display:flex;align-items:center;gap:var(--s3)"><div class="dots">${state.picks.map(() => '<i></i>').join('')}</div>
      ${n > 1 ? `<button class="iconbtn" data-act="prev" aria-label="Previous song">${icon('left')}</button><button class="iconbtn" data-act="next" aria-label="Next song">${icon('right')}</button>` : ''}</div></div>
    <div class="slides">${slides}</div>
    <p class="hint" style="margin-top:var(--s3)">Hearing only 30-second previews? Sign in to Spotify in this browser for full songs. <a id="openSpotify" href="#" target="_blank" rel="noopener noreferrer">Open in Spotify${icon('external')}</a></p>
    <div class="cta flow"><button class="btn primary block votebtn" data-act="vote-cur" id="votebtn">Vote for this song</button>
    ${state.me.isHost ? `<button class="btn block" data-act="toresults">Reveal results<span class="count nums">&nbsp;· <span data-count="voted"></span> voted</span></button>` : `<p class="hint" style="text-align:center;margin-top:var(--s3)">Votes in · <span class="nums" data-count="voted"></span></p>`}</div>`;
}
function patchVoting() {
  const slides = [...document.querySelectorAll('.slide')]; if (!slides.length) return;
  ui.cur = Math.max(0, Math.min(ui.cur, slides.length - 1));
  slides.forEach((s, i) => {
    const on = i === ui.cur; s.classList.toggle('cur', on);
    const f = s.querySelector('iframe'); const want = on ? f.dataset.src : 'about:blank';
    if (f.getAttribute('src') !== want) f.setAttribute('src', want);   // leaving a song stops its audio
  });
  document.querySelectorAll('.dots i').forEach((d, i) => { d.classList.toggle('on', i === ui.cur); d.classList.toggle('v', slides[i].dataset.id === state.myVote); });
  const c = document.querySelector('[data-cur]'); if (c) c.textContent = ui.cur + 1;
  const prev = document.querySelector('[data-act=prev]'), next = document.querySelector('[data-act=next]');
  if (prev) prev.disabled = ui.cur === 0; if (next) next.disabled = ui.cur === slides.length - 1;
  const o = document.getElementById('openSpotify'); if (o) o.href = 'https://open.spotify.com/track/' + slides[ui.cur].dataset.track;
  const b = document.getElementById('votebtn'); if (!b) return;
  const cur = slides[ui.cur], mine = cur.dataset.mine === '1', voted = state.myVote === cur.dataset.id;
  b.disabled = mine; b.classList.toggle('on', voted);
  b.innerHTML = mine ? 'This is your song' : voted ? `${icon('check')}Your vote` : 'Vote for this song';
}

/* ---------- results ---------- */
function resultsHtml() {
  const picks = state.picks, max = Math.max(0, ...picks.map((p) => p.voters.length));
  const winners = max > 0 ? picks.filter((p) => p.voters.length === max) : [], rest = picks.filter((p) => !winners.includes(p));
  const hero = winners.map((p) => { const t = splitTitle(p.title);
    return `<div class="podium" style="--d:${0.35 + rest.length * 0.14}s"><div class="winner">${art(p.thumb, 132)}<div><div class="tag">${winners.length > 1 ? 'Tied for the win' : 'Winner'}</div>
      <div class="t">${esc(t.title)}</div><div class="hint">${esc(p.author)}${p.voters.length ? ' · voted by ' + p.voters.map(esc).join(', ') : ''}</div>
      <div class="pts nums" data-countup="${p.voters.length * 100}">+${p.voters.length * 100}</div></div></div>${ui.open[p.id] ? `<div class="embed80">${embed(p.trackId)}</div>` : ''}
      <button class="btn ghost" style="padding-left:0;justify-self:start" data-act="toggle-embed" data-id="${esc(p.id)}">${icon('play')}${ui.open[p.id] ? 'Hide player' : 'Play it again'}</button></div>`; }).join('');
  const rows = rest.map((p, i) => { const t = splitTitle(p.title);
    return `<div style="--d:${(rest.length - 1 - i) * 0.14}s" class="rank"><span class="n nums">${winners.length + i + 1}</span>${art(p.thumb, 48)}
      <div class="tx"><div>${esc(t.title)}</div><div class="hint">${esc(p.author)} · ${p.voters.length} ${p.voters.length === 1 ? 'vote' : 'votes'}</div></div><span class="p nums">+${p.voters.length * 100}</span>
      <button class="iconbtn" data-act="toggle-embed" data-id="${esc(p.id)}" aria-label="Play song">${icon('play')}</button></div>${ui.open[p.id] ? `<div class="embed80">${embed(p.trackId)}</div>` : ''}`; }).join('');
  return `${stepsHtml('Results')}${hero ? `<div class="stack">${hero}</div>` : '<h2 class="section-title">No votes this round</h2>'}${rows ? `<div style="margin-top:var(--s6)">${rows}</div>` : ''}
    ${state.me.isHost ? `<div class="cta"><button class="btn primary block" data-act="next-scene">Next scene</button></div>` : waitHtml(`Waiting for ${esc(hostName())} to choose the next scene`)}`;
}
function actionHtml() {
  const host = state.me.isHost;
  if (isLobby()) return lobbyHtml();
  if (state.phase === 'setup') return host ? setupHtml() : waitHtml('Waiting for the host to choose a scene');
  if (state.phase === 'picking') return pickingHtml();
  if (state.phase === 'voting') return votingHtml();
  return host && ui.chooser ? setupHtml() : resultsHtml();
}

/* ---------- home ---------- */
function renderHome() {
  const key = JSON.stringify([ui.invite && ui.invite.status, ui.notice]);
  if (last.home === key) return; last.home = key; inRoom = false; document.body.dataset.phase = 'home';
  const inv = ui.invite;
  const notice = ui.notice ? `<p class="notice" role="status">${esc(ui.notice)}</p>` : '';
  const foot = `<p class="foot"><button class="linkbtn" data-act="credits">Credits &amp; privacy</button></p>`;
  if (inv && inv.status === 'ok') {
    $app.innerHTML = `<div class="home enter">${MARK}<p class="label" style="margin-top:var(--s5)">You're invited</p><h1>Join the game<i>.</i></h1>
      <div class="tiles inline">${[...inv.code].map((c) => `<span>${esc(c)}</span>`).join('')}</div>
      <p class="lede" style="margin-top:var(--s4)">${inv.players} ${inv.players === 1 ? 'player is' : 'players are'} waiting. Pick a name and jump in.</p>
      <div class="stack"><input data-bind="name" id="name" maxlength="20" placeholder="Your name" aria-label="Your name" autocomplete="nickname" value="${esc(ui.name)}">
      <button class="btn primary block" data-act="join-invite">Join game</button></div>
      <p class="err" id="err" role="alert">${esc(ui.err)}</p><p class="hint" style="margin-top:var(--s5)"><button class="linkbtn" data-act="skip-invite">Host your own game instead</button></p>${foot}</div>`;
    return;
  }
  const invMsg = inv && inv.status === 'missing' ? `<p class="notice" role="alert">We couldn't find a game with code ${esc(inv.code)}. It may have ended. Check the code with the host, or start your own game.</p>`
    : inv && inv.status === 'full' ? `<p class="notice" role="alert">That game is full (12 players). Ask the host to start a new one, or host your own.</p>` : '';
  $app.innerHTML = `<div class="home enter">${MARK}<h1>Score It<i>.</i></h1><p class="lede">The party game where your friends pick the song that belongs under the scene.</p>${notice}${invMsg}
  <div class="stack"><input data-bind="name" id="name" maxlength="20" placeholder="Your name" aria-label="Your name" autocomplete="nickname" value="${esc(ui.name)}">
    <button class="btn primary block" data-act="create">Host a game</button></div>
  <div class="or">or join</div>
  <div class="field"><input class="codein" data-bind="code" id="code" maxlength="4" placeholder="CODE" aria-label="Room code" autocapitalize="characters" autocomplete="off" value="${esc(ui.code)}"><button class="btn" data-act="join">Join</button></div>
  <p class="err" id="err" role="alert">${esc(ui.err)}</p>${foot}</div>`;
}

/* ---------- room ---------- */
function render() {
  if (!session || !state) { renderHome(); return; }
  delete last.home;
  if (!inRoom) {
    inRoom = true;
    $app.innerHTML = `<div id="s-head"></div><div class="room" id="room"><div class="col-main"><section id="s-stage"></section></div>
      <div class="col-side"><section id="s-action"></section><section id="s-players"></section><p class="err" id="err" role="alert"></p></div></div>`;
    ['s-head', 's-stage', 's-action', 's-players'].forEach((k) => { delete last[k]; });
  }
  const lobby = isLobby(), phaseKey = (lobby ? 'lobby' : state.phase) + ':' + state.round + (ui.chooser ? ':c' : '');
  document.body.dataset.phase = lobby ? 'lobby' : state.phase;
  document.getElementById('room').classList.toggle('lobby', lobby);
  if (state.phase === 'picking' && lastBase && lastBase !== 'picking:' + state.round && state.scene) showReveal(state.scene, state.round);
  setSection('s-head', headHtml(), 'h');
  setSection('s-stage', stageHtml(), 'scene' + state.round + JSON.stringify(state.scene || {}).length);
  setSection('s-action', actionHtml(), phaseKey);
  setSection('s-players', stripHtml(), 'p');
  patchCounts(); patchVoting(); autoLoadLibrary();
  const base = phaseKey.replace(':c', '');   // toggling the scene chooser is not a new phase
  if (base !== lastBase) {
    if (state.phase === 'picking' || state.phase === 'setup') { ui.sel = null; ui.cap = ''; }
    if (state.phase === 'picking') { ui.changing = false; ui.hits = null; ui.sq = ''; ui.chooser = false; }
    if (state.phase === 'voting') ui.cur = 0;
    if (state.phase === 'results') { ui.chooser = false; ui.open = {}; countUp(); }
    if (lastBase && !lobby && window.innerWidth < 960 && state.phase !== 'setup') window.scrollTo({ top: 0, behavior: 'smooth' });
    lastBase = base;
  }
  lastPhaseKey = phaseKey; setErr(ui.err);
}
function countUp() {
  document.querySelectorAll('[data-countup]').forEach((el) => {
    const to = Number(el.dataset.countup), t0 = performance.now() + 700, D = 900;
    const tick = (t) => { const k = Math.max(0, Math.min(1, (t - t0) / D)); el.textContent = '+' + Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
    el.textContent = '+0'; requestAnimationFrame(tick);
  });
}
function patchCounts() {
  const n = (k) => state.players.filter((p) => p[k]).length + '/' + state.players.length;
  document.querySelectorAll('[data-count=picked]').forEach((el) => { el.textContent = n('picked'); });
  document.querySelectorAll('[data-count=voted]').forEach((el) => { el.textContent = n('voted'); });
  const btn = document.querySelector('[data-act=tovote]'); if (btn) btn.disabled = !state.players.some((p) => p.picked);
  document.querySelectorAll('[data-pid]').forEach((el) => {
    const to = Number(el.dataset.score), prev = scoreMemo[el.dataset.pid];
    if (prev !== undefined && prev !== to) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    scoreMemo[el.dataset.pid] = to;
  });
}
function refreshAction() { if (state) { setSection('s-action', actionHtml(), (isLobby() ? 'lobby' : state.phase) + ':' + state.round + (ui.chooser ? ':c' : ''), true); patchCounts(); patchVoting(); } }
function autoLoadLibrary() {
  const open = state.me.isHost && (ui.chooser || (state.phase === 'setup' && state.round > 0));
  if (open) loadLibrary();
}
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => reject(new Error('Could not read that image.')); img.src = url;
  });
}
const linkToScene = (u) => { u = u.trim(); if (/youtu\.?be/.test(u)) return { kind:'youtube', url:u }; if (/\.(mp4|webm|mov)(\?|#|$)/i.test(u)) return { kind:'video', url:u }; return { kind:'image', url:u }; };

/* live Spotify search: results update in place so the input never loses focus */
let searchTimer = 0, searchSeq = 0;
function liveSearch() {
  clearTimeout(searchTimer);
  const q = ui.sq.trim(), box = () => document.getElementById('hits');
  if (!q) { ui.hits = null; if (box()) box().innerHTML = hitsHtml(); return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try { const hits = await api('search?q=' + encodeURIComponent(q)); if (seq !== searchSeq) return; ui.hits = hits; setErr(''); }
    catch (e) { if (seq !== searchSeq) return; setErr(e.message); if (e.status === 501 || e.status === 502) { ui.pickTab = 'link'; refreshAction(); } return; }
    if (box()) box().innerHTML = hitsHtml();
  }, 300);
}

/* ---------- credits + privacy ---------- */
function showCredits() {
  const el = document.createElement('div'); el.className = 'modal'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Credits and privacy');
  el.innerHTML = `<div class="sheet"><button class="iconbtn close" data-act="close-modal" aria-label="Close">${icon('close')}</button>
    <h2 class="section-title">Credits &amp; privacy</h2>
    <h3 class="label">Scene media</h3><p>Built-in photos and video clips come from <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a> and <a href="https://pixabay.com" target="_blank" rel="noopener noreferrer">Pixabay</a>. Each scene credits its creator and links back to the source. Used under the <a href="https://www.pexels.com/license/" target="_blank" rel="noopener noreferrer">Pexels License</a> and the <a href="https://pixabay.com/service/license-summary/" target="_blank" rel="noopener noreferrer">Pixabay Content License</a>. Written prompts are original to Score It.</p>
    <h3 class="label">Music</h3><p>Songs play through Spotify's embedded player, so Spotify's own terms and playback rules apply. Score It isn't affiliated with or endorsed by Spotify, Pexels or Pixabay.</p>
    <h3 class="label">Your data</h3><p>No accounts, no ads, no analytics. We keep your display name, song picks and votes in memory only while a game is active, and delete them after the game goes quiet (about 3 hours). Your browser stores a random player ID and your name so you can rejoin after a refresh. Spotify and YouTube embeds may set their own cookies.</p></div>`;
  const close = () => { el.remove(); document.removeEventListener('keydown', esc2); };
  const esc2 = (e) => { if (e.key === 'Escape') close(); };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-act=close-modal]')) close(); }); document.addEventListener('keydown', esc2);
  document.getElementById('overlay').appendChild(el); el.querySelector('.close').focus();
}

/* ---------- events (delegated so inputs keep focus) ---------- */
document.addEventListener('input', (e) => { const k = e.target.dataset && e.target.dataset.bind; if (!k) return; ui[k] = e.target.value;
  if (k === 'name') store.set('scoreit.name', ui.name);
  if (k === 'text') { const b = document.querySelector('[data-act=start]'); if (b) b.disabled = !(ui.sel || ui.text.trim()); }
  if (k === 'sq') liveSearch(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const k = e.target.dataset && e.target.dataset.bind; const map = { link:'submit-link', url:'use-link', name: ui.invite && ui.invite.status === 'ok' ? 'join-invite' : 'create', code:'join' }; if (map[k]) document.querySelector(`[data-act=${map[k]}]`)?.click(); }
  if (state?.phase === 'voting' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { if (e.key === 'ArrowRight') document.querySelector('[data-act=next]')?.click(); if (e.key === 'ArrowLeft') document.querySelector('[data-act=prev]')?.click(); }
});
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'file' || !e.target.files[0]) return;
  try { const url = await shrinkImage(e.target.files[0]); ui.sel = { kind:'image', url, thumb:url }; refreshAction(); } catch (err) { setErr(err.message); }
});
async function enter(kind, body) {
  try { const r = await api(kind, body); setErr(''); ui.notice = ''; ui.invite = null; history.replaceState(null, '', location.pathname); save({ code:r.code, pid:r.pid }); await poll(true); }
  catch (er) { setErr(er.message); }
}
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, d = el.dataset;
  switch (a) {
    case 'leave': if (state && state.players.length > 1 && !leaveArmed) { leaveArmed = true; toast('Tap again to leave the game'); setTimeout(() => { leaveArmed = false; }, 3000); return; } leaveArmed = false; api('leave', {}).catch(() => {}); return leave();
    case 'copy': navigator.clipboard?.writeText(state.code).then(() => toast('Room code copied')).catch(() => {}); return;
    case 'share': {
      const url = inviteUrl();
      if (navigator.share) { try { await navigator.share({ title: 'Join my Score It game', text: `Join my Score It game. Room code ${state.code}.`, url }); return; } catch (er) { if (er && er.name === 'AbortError') return; } }
      navigator.clipboard?.writeText(url).then(() => toast('Invite link copied')).catch(() => toast(url)); return;
    }
    case 'credits': return showCredits();
    case 'create': return enter('create', { name: ui.name });
    case 'join': return enter('join', { name: ui.name, code: ui.code });
    case 'join-invite': return enter('join', { name: ui.name, code: ui.invite.code });
    case 'skip-invite': ui.invite = null; ui.code = ''; history.replaceState(null, '', location.pathname); delete last.home; return render();
    case 'start-game': ui.chooser = true; return render();
    case 'back': ui.chooser = false; return render();
    case 'next-scene': ui.chooser = true; return render();
    case 'tab': ui.tab = d.t; ui.mood = null; ui.sel = null; refreshAction(); return loadLibrary();
    case 'ctab': ui.customTab = d.t; return refreshAction();
    case 'mood': ui.mood = d.m || null; refreshAction(); return loadLibrary();
    case 'reshuffle': delete ui.lib[libKey()]; return loadLibrary();
    case 'pick-lib': ui.sel = ui.lib[libKey()][Number(d.i)]; return refreshAction();
    case 'clear-scene': ui.sel = null; return refreshAction();
    case 'use-link': if (!ui.url.trim()) return setErr('Paste a link first.'); ui.sel = { ...linkToScene(ui.url), thumb: linkToScene(ui.url).kind === 'image' ? ui.url.trim() : null }; setErr(''); return refreshAction();
    case 'random': ui.chooser = false; ui.sel = null; return act('scene', { random:'any' });
    case 'start': {
      let body;
      if (ui.sel && ui.sel.id) body = { libraryId: ui.sel.id };
      else { let scene = ui.sel; if (!scene) scene = { kind:'text', caption: ui.text }; else scene = { ...scene, caption: ui.cap }; delete scene.thumb; body = { scene }; }
      ui.sel = null; ui.cap = ''; ui.text = ''; ui.chooser = false; return act('scene', body);
    }
    case 'ptab': ui.pickTab = d.t; return refreshAction();
    case 'change-pick': ui.changing = true; return refreshAction();
    case 'submit-link': { const url = ui.link; ui.link = ''; ui.changing = false; document.activeElement?.blur(); return act('pick', { url }).then(() => toast('Song locked in')); }
    case 'pick-song': document.activeElement?.blur(); ui.changing = false; ui.hits = null; ui.sq = ''; return act('pick', { trackId: d.id, title: d.title }).then(() => toast('Song locked in'));
    case 'prev': ui.cur--; return patchVoting();
    case 'next': ui.cur++; return patchVoting();
    case 'vote-cur': { const s = document.querySelectorAll('.slide')[ui.cur]; if (s && s.dataset.mine !== '1') return act('vote', { target: s.dataset.id }); return; }
    case 'toggle-embed': ui.open[d.id] = !ui.open[d.id]; return refreshAction();
    case 'tovote': return act('phase', { to:'voting' });
    case 'toresults': return act('phase', { to:'results' });
  }
});

/* ---------- boot ---------- */
fetch(SERVER + '/api/config').then((r) => r.json()).then((c) => { cfg = c; if (state) refreshAction(); }).catch(() => {});
if (ui.invite) {
  api('room?code=' + ui.invite.code).then((r) => { ui.invite.status = !r.exists ? 'missing' : r.full ? 'full' : 'ok'; ui.invite.players = r.players; delete last.home; render(); })
    .catch(() => { ui.invite = null; delete last.home; render(); });
}
render(); poll(true);
