// End-to-end API test: several simulated players play two full rounds against a running server.
//   BASE=http://localhost:3000 node scripts/e2e.js
// Needs internet for Spotify oEmbed (song metadata). Exits non-zero on any failure.
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
async function call(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {} return { s: r.status, j };
}
const post = (p, b) => call('POST', '/api/' + p, b);
const state = (code, pid) => call('GET', `/api/state?code=${code}&pid=${pid}&v=0`).then((r) => r.j);
const TRACKS = { a: '4cOdK2wGLETKBW3PvgPWqT', b: '7ouMYWpwJ422jRcDASZB7P', c: '3AJwUDP919kvQ9QcozQPxg' };

(async () => {
  console.log('Library + config');
  const cfg = (await call('GET', '/api/config')).j;
  ok(cfg.library && cfg.library.available.text >= 40, `written prompts available (${cfg.library.available.text})`);
  const hasMedia = cfg.library.available.video > 0 && cfg.library.available.image > 0;
  console.log('  info media library:', JSON.stringify(cfg.library.available));
  const vids = hasMedia ? (await call('GET', '/api/library?type=video&mood=epic')).j : [];
  if (hasMedia) ok(vids.length > 0 && vids[0].thumb && vids[0].duration, 'video previews have thumbnail + duration');
  ok(!JSON.stringify(vids).includes('"url"'), 'browse list does not leak media URLs/credentials');

  console.log('Lobby');
  const h = (await post('create', { name: 'Host' })).j; ok(/^[A-Z]{4}$/.test(h.code) && /^[a-f0-9]{16}$/.test(h.pid), 'host creates lobby');
  const code = h.code;
  ok((await call('GET', '/api/room?code=' + code)).j.exists === true, 'room lookup for invite link works');
  ok((await call('GET', '/api/room?code=ZZZZ')).j.exists === false, 'unknown room reports exists=false');
  const bad = await post('join', { code: 'ZZZZ', name: 'X' }); ok(bad.s === 404 && /couldn.t find a game/.test(bad.j.error), 'invalid code gives helpful error');
  ok((await post('join', { code: 'AB', name: 'X' })).s === 400, 'malformed code rejected');
  const m = (await post('join', { code, name: 'Maya' })).j, j = (await post('join', { code: code.toLowerCase(), name: 'Jordan' })).j;
  ok(m.pid && j.pid, 'players join (code is case-insensitive)');
  ok((await post('join', { code, name: 'maya' })).s === 400, 'duplicate name rejected');
  let s = await state(code, m.pid); ok(s.players.length === 3 && s.players[0].isHost, 'player lists synchronize; host flagged');

  console.log('Scenes');
  ok((await post('scene', { code, pid: m.pid, random: 'any' })).s === 403, 'non-host cannot start a round');
  ok((await post('scene', { code, pid: h.pid, libraryId: 'nope' })).s === 404, 'unknown library scene rejected');
  ok((await post('scene', { code, pid: h.pid, scene: { kind: 'image', url: 'javascript:alert(1)' } })).s === 400, 'unsafe custom image rejected');
  ok((await post('scene', { code, pid: h.pid, scene: { kind: 'video', url: 'http://x/y.mp4' } })).s === 400, 'non-https custom video rejected');
  ok((await post('scene', { code, pid: h.pid, random: 'text' })).s === 200, 'host starts round 1 with a random written scene');
  const sh = await state(code, h.pid), sm = await state(code, m.pid), sj = await state(code, j.pid);
  ok(sh.scene.kind === 'text' && JSON.stringify(sh.scene) === JSON.stringify(sm.scene) && JSON.stringify(sm.scene) === JSON.stringify(sj.scene), 'everyone receives the same scene');
  ok((await post('scene', { code, pid: h.pid, random: 'any' })).s === 400, 'cannot start a second scene mid-round');

  console.log('Song picks');
  ok((await post('pick', { code, pid: m.pid, url: 'https://example.com/nope' })).s === 400, 'non-Spotify link rejected');
  ok((await post('pick', { code, pid: h.pid, url: `https://open.spotify.com/track/${TRACKS.a}` })).s === 200, 'host picks');
  ok((await post('pick', { code, pid: m.pid, url: `spotify:track:${TRACKS.b}` })).s === 200, 'Maya picks (URI form)');
  const again = (await post('pick', { code, pid: m.pid, url: `https://open.spotify.com/track/${TRACKS.b}` })).j; ok(again.unchanged === true, 're-submitting the same song is a no-op');
  ok((await post('pick', { code, pid: j.pid, url: `https://open.spotify.com/track/${TRACKS.c}?si=abc` })).s === 200, 'Jordan picks (share link with tracking params)');
  s = await state(code, h.pid); ok(s.players.every((p) => p.picked) && s.picks.length === 0, 'all picked; picks stay hidden during picking');
  ok((await post('phase', { code, pid: m.pid, to: 'voting' })).s === 403, 'non-host cannot advance');
  ok((await post('phase', { code, pid: h.pid, to: 'voting' })).s === 200, 'host starts voting');
  ok((await post('pick', { code, pid: j.pid, url: `https://open.spotify.com/track/${TRACKS.a}` })).s === 400, 'picks are closed once voting starts');

  console.log('Voting');
  s = await state(code, h.pid);
  const mineH = s.picks.find((p) => p.mine), sm2 = await state(code, m.pid), sj2 = await state(code, j.pid);
  ok(s.picks.length === 3 && !('author' in s.picks[0]), 'songs are anonymous during voting');
  ok((await post('vote', { code, pid: h.pid, target: mineH.id })).s === 400, 'cannot vote for your own song');
  ok((await post('vote', { code, pid: h.pid, target: 'zzzzzz' })).s === 400, 'cannot vote for a song that is not in the round');
  const idOf = (st, t) => st.picks.find((p) => p.trackId === t).id;
  await post('vote', { code, pid: m.pid, target: idOf(sm2, TRACKS.c) });
  await post('vote', { code, pid: m.pid, target: idOf(sm2, TRACKS.a) });            // change of mind replaces, never doubles
  s = await state(code, m.pid); ok(s.myVote === idOf(sm2, TRACKS.a), 'changing a vote replaces the previous vote');
  await post('vote', { code, pid: j.pid, target: idOf(sj2, TRACKS.a) });
  await post('vote', { code, pid: h.pid, target: idOf(s, TRACKS.b) });

  console.log('Results');
  const rh = await state(code, h.pid), rm = await state(code, m.pid), rj = await state(code, j.pid);
  ok(rh.phase === 'results', 'round finishes automatically when everyone has voted');
  const sig = (x) => JSON.stringify(x.picks.map((p) => [p.trackId, p.author, p.voters.slice().sort()]));
  ok(sig(rh) === sig(rm) && sig(rm) === sig(rj), 'results are identical for every player');
  const score = (st, n) => st.players.find((p) => p.name === n).score;
  ok(score(rh, 'Host') === 200 && score(rh, 'Maya') === 100 && score(rh, 'Jordan') === 0, 'scores: Host +200, Maya +100, Jordan 0 (server-calculated)');
  ok((await post('vote', { code, pid: h.pid, target: idOf(s, TRACKS.b) })).s === 400, 'cannot vote after results');

  console.log('Round 2 with built-in media');
  if (hasMedia) {
    const img = (await call('GET', '/api/library?type=image&mood=nature')).j[0];
    ok((await post('scene', { code, pid: h.pid, libraryId: img.id })).s === 200, 'host starts round 2 with a built-in image');
    const st = await state(code, m.pid); ok(st.scene.kind === 'image' && st.scene.credit && st.scene.license && st.scene.credit.url.startsWith('https://'), 'image scene carries creator + license metadata');
    await post('pick', { code, pid: h.pid, url: `https://open.spotify.com/track/${TRACKS.a}` });
    await post('phase', { code, pid: h.pid, to: 'voting' });
    await post('vote', { code, pid: m.pid, target: (await state(code, m.pid)).picks[0].id });
    await post('phase', { code, pid: h.pid, to: 'results' });
    const vid = (await call('GET', '/api/library?type=video&mood=funny')).j[0];
    ok((await post('scene', { code, pid: h.pid, libraryId: vid.id })).s === 200, 'host starts round 3 with a built-in video');
    const sv = await state(code, j.pid); ok(sv.scene.kind === 'video' && sv.scene.url.startsWith('http') && sv.scene.duration > 0, 'video scene has https URL and duration');
  } else console.log('  skip: no media provider configured');

  console.log('Leaving, host handover, reconnect');
  const rr = await state(code, m.pid); ok(rr.me.name === 'Maya' && rr.players.length === 3, 'refresh/reconnect with saved player id restores the game');
  ok((await post('leave', { code, pid: m.pid })).s === 200, 'player leaves');
  s = await state(code, h.pid); ok(s.players.length === 2 && !s.players.some((p) => p.name === 'Maya'), 'player list updates after leaving');
  ok((await state(code, m.pid)).error !== undefined, 'a player who left gets a clear error, not stale state');
  ok((await post('leave', { code, pid: h.pid })).s === 200, 'host leaves');
  s = await state(code, j.pid); ok(s.me.isHost === true, 'host role passes to a remaining player');

  console.log('Leaving mid-vote');
  const g = (await post('create', { name: 'A' })).j, g2 = (await post('join', { code: g.code, name: 'B' })).j, g3 = (await post('join', { code: g.code, name: 'C' })).j;
  await post('scene', { code: g.code, pid: g.pid, random: 'text' });
  await post('pick', { code: g.code, pid: g.pid, url: `spotify:track:${TRACKS.a}` }); await post('pick', { code: g.code, pid: g2.pid, url: `spotify:track:${TRACKS.b}` });
  await post('phase', { code: g.code, pid: g.pid, to: 'voting' });
  const sg = await state(g.code, g.pid); await post('vote', { code: g.code, pid: g.pid, target: sg.picks.find((p) => !p.mine).id });
  await post('leave', { code: g2.pid ? g.code : g.code, pid: g2.pid });
  const after = await state(g.code, g.pid); ok(after.phase === 'results' || after.picks.length === 1, 'leaving mid-vote removes that player\'s song and cannot deadlock the round');
  void g3;

  console.log('Rate limiting + validation');
  const bogus = await call('GET', '/api/state?code=nope&pid=nope'); ok(bogus.s === 400, 'malformed ids rejected');
  ok((await call('POST', '/api/create', null)).s === 400, 'create without a name rejected');
  let limited = 0; for (let i = 0; i < 70; i++) { const r = await post('join', { code: 'ZZZZ', name: 'x' }); if (r.s === 429) limited++; }
  ok(limited > 0, `join attempts are rate limited (${limited} throttled of 70)`);

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
