// TEST HARNESS ONLY - never used in production.
// Imitates the shapes of the Pexels and Pixabay APIs so the library code can be exercised end to end
// without real API keys. Media URLs point at a real CC0 sample video and a real Pexels CDN photo.
//   node scripts/mock-providers.js            (listens on :4010)
//   PEXELS_API_KEY=test PIXABAY_API_KEY=test PEXELS_API_BASE=http://localhost:4010 PIXABAY_API_BASE=http://localhost:4010/pixabay node server.js
const http = require('http');
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const PHOTO = (n) => `https://images.pexels.com/photos/2387873/pexels-photo-2387873.jpeg?auto=compress&cs=tinysrgb&w=${900 + n}`;
const h = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const q = u.searchParams.get('query') || u.searchParams.get('q') || 'x'; const base = h(q) % 100000;
  if (u.pathname === '/videos/search') return json(res, { videos: [0, 1, 2, 3].map((i) => ({ id: base * 10 + i, url: `https://www.pexels.com/video/test-${base}-${i}/`, image: PHOTO(i + base % 50), duration: 8 + i,
    user: { name: 'Test Creator ' + i }, video_files: [{ file_type: 'video/mp4', width: 1280, height: 720, link: VIDEO + `?t=${base}${i}` }, { file_type: 'video/mp4', width: 426, height: 240, link: VIDEO }] })) });
  if (u.pathname === '/v1/search') return json(res, { photos: [0, 1, 2, 3].map((i) => ({ id: base * 10 + i, url: `https://www.pexels.com/photo/test-${base}-${i}/`, photographer: 'Test Photographer ' + i, alt: q,
    src: { large: PHOTO(i + base % 50), medium: PHOTO(i + base % 50) } })) });
  if (u.pathname === '/pixabay/videos/') return json(res, { hits: [0, 1, 2].map((i) => ({ id: base * 10 + i, pageURL: `https://pixabay.com/videos/test-${base}-${i}/`, user: 'Pixabay Tester ' + i, duration: 9 + i,
    videos: { small: { url: VIDEO + `?p=${base}${i}`, width: 1280, height: 720, thumbnail: PHOTO(i + base % 50) } } })) });
  if (u.pathname === '/pixabay/') return json(res, { hits: [0, 1, 2].map((i) => ({ id: base * 10 + i, pageURL: `https://pixabay.com/photos/test-${base}-${i}/`, user: 'Pixabay Tester ' + i, tags: q,
    largeImageURL: PHOTO(i + 100 + base % 50), webformatURL: PHOTO(i + base % 50) })) });
  res.writeHead(404); res.end();
}).listen(4010, () => console.log('mock providers on :4010'));
