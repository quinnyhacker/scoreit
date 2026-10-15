# Score It

A multiplayer party game: everyone sees the same scene (video, image or written prompt), picks the Spotify song that
fits best, then votes on whose song nails it.

See **[RELEASE-READINESS.md](RELEASE-READINESS.md)** for launch status, licensing, Spotify policy findings and blockers.

## Layout
- `server.js` - Node server, no runtime dependencies. Authoritative game state in memory, serves the app and `/api/*`.
- `lib/library.js` - built-in scene library (Pexels / Pixabay curation + cache). `lib/written-scenes.js` - original written prompts.
- `lib/ratelimit.js` - per-IP rate limiter.
- `public/` - `index.html` (styles), `app.js` (client), `config.js` (server URL for the iOS build).
- `scripts/e2e.js` - end-to-end API test. `scripts/mock-providers.js` - **test-only** stand-in for the Pexels/Pixabay APIs.
- `ios/`, `capacitor.config.json`, `codemagic.yaml` - iOS wrapper and TestFlight build.
- `render.yaml` - Render blueprint (Starter plan, one instance).

## Run locally
```
node server.js                 # http://localhost:3000  (written prompts + paste-a-song-link work with no keys)
```
Invite links look like `http://localhost:3000/?join=ABCD`.

## Environment variables (server only, never in the browser or the repo)
| Variable | Purpose |
|---|---|
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Optional song search (otherwise players paste a Spotify link) |
| `PIXABAY_API_KEY` | Built-in videos and images from Pixabay |
| `PEXELS_API_KEY` | Built-in videos and images from Pexels |
| `ALLOWED_ORIGINS` | Extra CORS origins (the iOS app origins are built in) |
| `TRUST_PROXY` | `0` to ignore `X-Forwarded-For` when not behind a proxy (default: trusted, as on Render) |
| `LIBRARY_BLOCKLIST` | Comma-separated library ids to hide after human review |
| `LIBRARY_CACHE_DIR` | Where the 24h library cache and downloaded Pixabay images live |
In hosted environments set secrets through the host's secret store (Render Environment; Azure Key Vault if moved to Azure). Never commit them.

## Scene library
- Written prompts: 48, original. Video/image: fixed reviewed queries per mood, refreshed every 24 h, about 24 API calls per provider per day.
- Each scene stores creator, source URL, provider and license; the UI credits creators and links to the providers.
- Pixabay images are downloaded and served from `/media/` (Pixabay forbids permanent hotlinking); videos are embedded.
- To curate: browse the library in the app, then add unwanted ids to `LIBRARY_BLOCKLIST`.

## Tests
```
node scripts/mock-providers.js &                      # optional: fake provider APIs for local library testing
PORT=3140 PEXELS_API_KEY=test PIXABAY_API_KEY=test PEXELS_API_BASE=http://localhost:4010 \
  PIXABAY_API_BASE=http://localhost:4010/pixabay node server.js &
BASE=http://localhost:3140 npm run test:e2e           # 49 checks across two full games; needs internet for Spotify oEmbed
```
The e2e run intentionally trips the join rate limit, so use a fresh server for each run.

## Deploy (Render)
1. Push to the private GitHub repo. In Render: **New > Blueprint**, pick the repo (reads `render.yaml`).
2. Enter secrets in **Environment** (see table). Keep **one instance**; game state lives in memory.
3. Health check: `/healthz`. Watch logs for `[library] N media scenes ready`.
4. Open the URL, host a game, send the invite link to a phone.

## iOS (Capacitor + Codemagic)
Set `window.SCOREIT_SERVER` in `public/config.js` to the hosted HTTPS URL, then run the Codemagic `ios-testflight` workflow
(bundle ID `com.quinny.scoreit`). See `codemagic.yaml` for the one-time App Store Connect API key setup.

## Software inventory
| Component | Use | License |
|---|---|---|
| Node.js 22+ | Server runtime | MIT |
| `@capacitor/core`, `ios`, `cli` 8.x | iOS wrapper (dev/build only) | MIT |
| Pexels API / Pixabay API | Built-in scene media (credited, cached 24 h) | Pexels License / Pixabay Content License |
| Spotify embeds + oEmbed + Web API (search) | Song playback, metadata, search | Spotify Developer Terms |
| YouTube nocookie embed | Optional custom scenes | YouTube terms |

`npm audit` reports 3 moderate findings in `@capacitor/cli` (transitive `xcode`), build-time only; no Critical/High.

## Data
Public/Internal game data only: a display name, song picks and votes, kept in server memory while a game is active and
deleted after about 3 hours of inactivity. No accounts, no analytics. Browsers store a random player id and name in localStorage.
