# Score It - Release Readiness Report

Status: **not yet cleared for public launch.** The game flow is complete and tested end to end, but there is one
policy blocker (Spotify, below) and several operational gaps that need a decision. Nothing in this report has been
deployed; pushing to `main` triggers a Render auto-deploy, so that needs your explicit go-ahead.

## 1. What was built and tested

| Area | Result | How it was verified |
|---|---|---|
| Built-in scene library (video, image, written) | Built | 48 original written prompts; video/image curated per mood from Pexels / Pixabay, cached 24h |
| Scene picker (Random, Videos, Images, Written, Custom, mood chips, previews, durations) | Built | Browser run on a phone-size viewport |
| Invite links (`/?join=CODE`), name-only join, invalid/full-code messages | Built | Browser + API tests |
| Lobby sync, host start, same scene for all players | Verified | `scripts/e2e.js` (49 checks, all pass) |
| One pick / one vote per player, no self-vote, picks closed after voting, scoring server-side | Verified | `scripts/e2e.js` |
| Results identical for every player | Verified | `scripts/e2e.js` |
| Refresh / reconnect restores the game | Verified | Browser (localStorage session) + API |
| Player leaves, host handover, leaving mid-vote cannot deadlock | Verified | `scripts/e2e.js` |
| Online/offline status, "Reconnecting" banner, "game ended" message | Built / browser-checked | Browser |
| Rate limiting, input validation, security headers | Built | `scripts/e2e.js` (join throttling), manual |
| Built-in video, image, written scenes render | Verified | Browser (video playing, readyState 4; Pixabay image served from own cache) |
| Spotify track search UI, locked-in confirmation | UI verified with **sample results only** | See section 4 |

**Honest limits of testing:** the media library was exercised against a local stand-in for the Pexels/Pixabay APIs
(`scripts/mock-providers.js`, test harness only, never shipped) because no working provider key was available to me.
Real provider responses, real Spotify search and real multi-device play still need a pass on the deployed site.
There is no automated browser test suite; browser checks were manual. The iPhone app build is untested.

## 2. Scene content: licensing and architecture

Sources read on the day of writing (re-check before launch, terms change):
[Pexels API docs](https://www.pexels.com/api/documentation/), [Pexels license](https://www.pexels.com/license/),
[Pixabay API docs](https://pixabay.com/api/docs/), [Pixabay license summary](https://pixabay.com/service/license-summary/).

| | Pexels | Pixabay |
|---|---|---|
| Attribution | API terms: **prominent link to Pexels** and credit creators | Show users where media came from whenever results are shown |
| Rate limit | 200/hour, 20,000/month (free; higher on request) | 100 requests per 60 s per key |
| Caching | No explicit rule in the API docs | **Must cache requests 24h** |
| Hotlinking | Not addressed in the API docs | **Permanent hotlinking of images not allowed; download images.** Videos may be embedded |
| Do not | Replicate Pexels' core functionality; circumvent limits; show identifiable people negatively; imply endorsement | Sell/distribute content standalone; misuse recognizable brands/people; mislead |
| Key status | **New keys currently paused** (per your Pexels signup) | You have one (see section 6) |

How the app complies:
- Keys live in server environment variables only; the browser never sees a key or a provider URL list it could abuse.
- The library is built from a **fixed, reviewed query list per mood** (24 provider calls per day per provider),
  cached 24h in memory + disk. **Nothing is fetched during gameplay.**
- Every scene stores creator, source page, provider and license (`license.name` / `license.url`) and the UI shows
  "Photo/Video by *creator* on *provider*" with links, plus provider links in the scene picker and a Credits screen.
- Pixabay **images are downloaded to the server** and served from `/media/`; Pixabay videos are embedded from their CDN.
  Pexels media is loaded from the Pexels CDN URLs the API returns (the docs are silent on hotlinking; see risks).
- Videos are limited to 25 s, 640-1280 px wide mp4, with poster thumbnails; scene media is lazy-loaded in the picker.
- Unavailable media: if a scene fails to load the game shows a clear message and continues.
- `LIBRARY_BLOCKLIST=id1,id2` removes specific items after review.

Risks to accept or resolve:
1. **Curation is query-based, not human-reviewed.** A person should browse the library once before launch and
   blocklist anything unsuitable (the Pexels/Pixabay licenses prohibit showing identifiable people negatively).
2. **Pexels hotlinking** is unaddressed in the docs. If you want certainty, email Pexels or switch Pexels media to
   the same download-and-serve path used for Pixabay images.
3. Not legal advice. Have someone qualified read the two provider terms against your launch plans.

## 3. Launch blockers and open decisions

| # | Item | Severity | Needed from you |
|---|---|---|---|
| 1 | **Spotify policy: synchronizing recordings with visual media** (section 4) | **Blocker** | Spotify/legal answer |
| 2 | **Game state is in memory.** A Render deploy/restart ends every game in progress. Single instance only | High | Accept, or add Redis/Postgres (real persistence) |
| 3 | Render Starter plan is required (free tier sleeps and wipes games) | High | Billing OK |
| 4 | Custom scenes (image URL / upload / YouTube link) are shown to other players **unmoderated**. Fine for friends, risky for strangers | Medium | Decide: keep for private games, or remove/moderate before a public launch |
| 5 | Duplicate songs: two players may pick the same song. The rules never said otherwise | Low | Your call: allow (current) or reject |
| 6 | Join links work for anyone with the code; no accounts. Codes are 4 letters (~457k combos) with rate limiting | Low | Accept for a casual game |
| 7 | Polling every 1.5 s (no WebSockets). Fine for dozens of simultaneous games, not thousands | Low | Revisit if you grow |
| 8 | Privacy/cookie text is a plain-language note, not a legal review. Spotify/YouTube embeds set cookies (consent banner may be needed in the EU) | Medium | Legal review if public |
| 9 | Accessibility: labels, focus rings, reduced-motion, 44px targets added; **no formal audit or screen-reader pass** | Medium | Schedule an audit |
| 10 | No error monitoring/alerting; logs only on Render | Medium | Add if launching publicly |

## 4. Spotify: playback and policy findings

Sources: [Developer Policy](https://developer.spotify.com/policy), [Developer Terms](https://developer.spotify.com/terms),
[Feb 2026 Dev Mode migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide),
[Embeds docs](https://developer.spotify.com/documentation/embeds).

- **Policy III.6: "Do not synchronize any sound recordings with any visual media."** The core idea of Score It is
  pairing a song with a scene. As built, **nothing is programmatically synchronized**: the scene video is muted and looping,
  the song plays only when a player presses play in Spotify's own embedded player, and no timing is linked. But
  a reviewer could still read "a song played alongside a video/image" as covered. I cannot resolve that; **Spotify (or counsel)
  must.** Recommended: ask Spotify Developer Support in writing, describing the game, before launching publicly.
- **No unauthorized playback.** The app uses only Spotify's official embed player (and oEmbed metadata). It does not stream,
  download, proxy or rip audio, and does not use preview clips itself. Embeds are governed by Spotify's Widget/Embed terms
  (not fully reproduced in the docs I could read).
- **Playback depends on the listener.** Spotify streaming is for Premium subscribers; logged-out listeners generally get
  short previews inside embeds. The app tells players this and offers an "Open in Spotify" link.
- **Search (Web API, server-side client credentials).** Since Feb 2026, Development Mode apps need a Premium app owner,
  new apps are limited to 5 users, and `search` returns at most 10 results (the app requests 10). Whether a public app
  using server-side search is allowed under Development Mode is **not stated in the documentation I could reach**; reports
  say Extended Quota requires an organization with a large user base. **If search is refused, the "Paste link" flow still
  works** with no Spotify credentials (it uses public oEmbed). The app falls back to it automatically on search errors.
- Metadata and cover art are held only in memory for the life of a game (not stored indefinitely).
- Keep Spotify branding/attribution intact (embeds do this) and the Credits screen states the app is unaffiliated.

If Spotify says no: compliant alternatives are (a) a "listen-then-describe" variant where the song and scene are never shown
together on one screen, or (b) written/spoken prompts only with songs played off-screen in the Spotify app. Both change the
experience; I have not built either without your decision.

## 5. Multiplayer audit (server is authoritative)

Verified by `scripts/e2e.js`: joining by code (case-insensitive), duplicate-name rejection, invalid/malformed code errors,
host-only actions (403 otherwise), single in-flight round, picks closed after voting, anonymous songs during voting,
no self-votes, vote replacement (never double counting), automatic round finish when all eligible players voted, identical results for
all players, scoring (+100/vote) computed only on the server and only once per round, rejoin by saved player ID,
leaving, host handover, mid-vote leave without deadlock, rate limiting.

Added in this pass: `leave`, player presence (online/offline), host handover when the host is gone 60 s, removal of players
gone 20 min, idle-room expiry (3 h), per-IP rate limits (join 60/10 min, create 20/10 min, search 60/min, global 2400/min),
strict id/code validation, same-origin CSP + hardened headers, `Retry-After` on 429, friendly error messages, double-submit locks in the client,
and instant re-sync when a phone wakes or comes back online.

Not done: kicking a player, host-less play if everyone is offline, shared-NAT tuning of rate limits (a very large party
behind one IP could approach the global limit).

## 6. Credentials and secrets

| Variable | Purpose | Where to get it |
|---|---|---|
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Song search (optional) | developer.spotify.com dashboard |
| `PIXABAY_API_KEY` | Built-in videos/images | pixabay.com/api/docs |
| `PEXELS_API_KEY` | Built-in videos/images (keys currently paused) | pexels.com/api |
| `ALLOWED_ORIGINS`, `TRUST_PROXY`, `LIBRARY_BLOCKLIST`, `LIBRARY_CACHE_DIR` | Optional tuning | see README |

Enter keys **only** in the Render dashboard (Environment). **The Pixabay key you pasted into chat earlier is exposed;
rotate it** before relying on it. Written prompts work with no key at all.

## 7. Deployment steps (existing stack: GitHub + Render)

1. Rotate the Pixabay key; in Render > `score-it` > Environment set `PIXABAY_API_KEY` (and Spotify keys if search is wanted).
2. Confirm the service is the **Starter** plan with **1 instance** (`render.yaml` already says so).
3. Push to `main` (auto-deploys). Watch the log for `[library] N media scenes ready`.
4. Smoke test the live URL: `BASE=https://score-it-hjq1.onrender.com node scripts/e2e.js` (use a fresh service: it creates test games and trips the join rate limit on purpose).
5. Play one real game with 3 phones, including a built-in video, a built-in image, a written prompt, and an invite link.
6. Human-review the library (Create a game > Videos / Images, all moods) and blocklist anything unsuitable.
7. Get the Spotify answer (section 4) before any public announcement.

## 8. Rollback

Redeploy the previous commit `054cf83` from Render's Deploys tab (or `git revert` this release). That version has no built-in library and no
leave/host handover, but is otherwise compatible.
