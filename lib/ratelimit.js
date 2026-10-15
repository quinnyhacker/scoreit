'use strict';
// Tiny fixed-window per-key limiter (in memory; fine for a single instance).
function limiter(max, windowMs) {
  const hits = new Map();
  const t = setInterval(() => { const now = Date.now(); for (const [k, e] of hits) if (now > e.reset) hits.delete(k); }, windowMs).unref();
  void t;
  return (key) => {
    const now = Date.now(); let e = hits.get(key);
    if (!e || now > e.reset) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
    e.n++;
    return { ok: e.n <= max, retry: Math.max(1, Math.ceil((e.reset - now) / 1000)) };
  };
}
module.exports = { limiter };
