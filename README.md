# Score It

Players join a session, get a scene (text or image), each pick a Spotify track, then vote on whose song fits best.

## Layout
- `server.js` - Node server (no runtime dependencies), in-memory rooms, serves the web app and `/api/*`
- `public/` - web client (`index.html`, `config.js`)
- `ios/` - Capacitor iOS shell (generated; wraps `public/`)
- `codemagic.yaml` - cloud build to TestFlight

## Run locally
```
node server.js        # http://localhost:3000
```
Optional Spotify search: set `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` (source from Azure Key Vault in any hosted environment; never commit).

## Deploy the server (Render, via `render.yaml`)
1. Push this repo to a private GitHub repo.
2. In Render: New > Blueprint > pick the repo. It reads `render.yaml` (Starter plan, one instance, health check `/healthz`).
3. Optional Spotify search: add `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` in the Render dashboard.
   Optional scene library (stock photos + video clips): add `PEXELS_API_KEY` (free at pexels.com/api). Without it, hosts can still paste image / mp4 / YouTube links, upload a photo, or describe a scene in text.
4. Copy the service URL (`https://score-it-xxxx.onrender.com`) into `public/config.js` for the iOS build.

## Alternative: Azure App Service
Rooms live in memory, so run **exactly one instance** (no scale-out) and expect sessions to reset on restart.
1. Create a Linux App Service (Node 22), HTTPS only, minimum TLS 1.2. Set the start command to `node server.js`.
2. Deploy with `npm ci --omit=dev` (the server has no runtime dependencies; Capacitor is dev-only).
3. App settings: `ALLOWED_ORIGINS` (only if you add extra web origins). For Spotify search, add the two Spotify settings as **Key Vault references**, not plain values.
4. Health check path: `/healthz`.
5. Entra ID: put App Service Authentication in front if this must be internal-only. Note the native app would then need an Entra sign-in flow.

## Build the iOS app
1. Set `window.SCOREIT_SERVER` in `public/config.js` to the hosted HTTPS URL (do this on the iOS build only; keep it empty for the web build).
2. Set `appId` in `capacitor.config.json` to your bundle ID (also in `codemagic.yaml`).
3. Create the app record in App Store Connect with that bundle ID.
4. Connect this repo to Codemagic, add the App Store Connect API key integration named `scoreit_asc`, and run the `ios-testflight` workflow. The build appears in TestFlight after Apple processing.
5. Add app icon and splash assets (`@capacitor/assets` can generate them from one 1024px image).

## Inventory (software / owner TBD)
| Component | Version | Use | License |
|---|---|---|---|
| Node.js | 22+ | server runtime | MIT |
| @capacitor/core, ios, cli | 8.x | iOS wrapper (dev/build only) | MIT |
| Spotify oEmbed / Web API | - | track metadata, optional search | Spotify developer terms |
| Spotify embed player | - | playback in page | Spotify developer terms |

Known audit note: `npm audit` reports 3 moderate findings in `@capacitor/cli` (transitive `xcode` package), build-time only, no Critical/High.

## Data classification
Public/Internal game data only (display names, song picks). No CUI or regulated data.
