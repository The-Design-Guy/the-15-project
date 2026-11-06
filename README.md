# THE 15 PROJECT
15 minutes. Stronger every day.

A private, mobile-first training companion: 12-week beginner program, 15-minute timed sessions, Quick 5, progress tracking, Body Timeline photos and Fuel recipes.

## What this is
A **static, local-first web app** — no build step, no backend, no account.
All personal data (sessions, weights, photos, settings) is stored **only in the browser on this device** (localStorage + IndexedDB). There is **no cross-device sync**. Use *Settings → Export backup* regularly.

## Run locally
Any static server works:
```bash
npx serve .
# or
python3 -m http.server 8080
```
Open http://localhost:8080. (Camera, microphone and PWA install require HTTPS or localhost.)

## Deploy to Vercel
1. Push this folder to a GitHub repository.
2. In Vercel: **Add New → Project → Import** the repo.
3. Framework preset: **Other**. Build command: *none*. Output directory: `./`.
4. Deploy. Every push to `main` redeploys automatically.

## Structure
```
index.html            App (single Design Component: markup + logic)
support.js            Component runtime (required, do not edit)
manifest.webmanifest  PWA manifest
brand/                Logo + favicon
icons/                UI icons (SVG)
exercises/            Exercise images, 1:2 — named <exercise-id>.png
```

## Updating content
Exercises, workouts, schedule, soundtrack profiles and recipes are defined as data at the top of the logic script in `index.html` (`EX`, `W`, `SCHED`, `PROFILES`, `RECIPES`).
- **New exercise image:** add `exercises/<id>.png` (1:2) and add the id to the `HAS` set.
- **New recipe:** append an object to `RECIPES` (title, category, ingredients, steps, subs, nutrition, source, status).
Commit → push → Vercel redeploys.

## Feature status (honest)
| Feature | Status |
|---|---|
| 15-min player, Quick 5, accurate timer, pause/resume, prev/next/skip | ✅ Working |
| Last-10-seconds countdown + optional male/female voice (device TTS) | ✅ Working |
| 12-week plan, rescheduling, feedback-based level suggestions | ✅ Working |
| Progress: weight/waist/energy log, session history, RPE | ✅ Working |
| Body Timeline: local photos, compare slider, time-lapse, delete | ✅ Working (local only) |
| Backup export / import, delete all data | ✅ Working |
| Fuel: browse, search, filter, favorites, notes | ✅ Working (draft content) |
| Voice command dispatcher (typed commands, EN/HE allowlist) | ✅ Working |
| Spotify connect (PKCE), playlists per profile, play/pause/next/prev/shuffle, devices, add current track, Refresh Mix with approval | ✅ Implemented — NOT VERIFIED on a real device |
| OpenAI speech-to-text endpoint | ⛔ Not implemented — NOT VERIFIED |
| Offline service worker | ⛔ Not implemented |

## Spotify setup
- Client ID is set in `index.html` (`SP_ID`). No client secret is used (Authorization Code + PKCE).
- Spotify dashboard → Redirect URI: `https://the-15-project.vercel.app/callback` (handled by the rewrite in `vercel.json`).
- Add your Spotify account under **User Management** (Development Mode: max 5 users, owner needs Premium).
- Scopes: playback state/control, currently playing, playlist read/modify.
- Tokens are stored in this browser's localStorage. Use **Disconnect** in Music to clear them.
- Playback happens in the Spotify app on an active device; the web app only controls it.
- Recommendations / audio-features are not available to new apps, so BPM is creative direction only and Refresh Mix uses search + your approval.

## Roadmap
1. `api/voice` Vercel function: audio → OpenAI transcription → allowlisted intent JSON (rate-limited, key in `OPENAI_API_KEY`).
3. Service worker for offline timer.
4. Missing images: Standing Knee Drives, Incline Mountain Climbers.

## Health note
General wellness guidance, not medical advice. Stop for pain, dizziness or unusual breathlessness, and consult a clinician about persistent fatigue or new symptoms.
