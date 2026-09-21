# Intel Prime — Geo-Intelligence Workspace

The first workspace slice is a browser-based case board for geospatial evidence. It provides a MapLibre GL JS map, OSM-compatible raster tiles, a local evidence register, editing/deletion, source links, confidence, timestamps, and a timeline view. Evidence is stored in IndexedDB. If IndexedDB is unavailable, the app uses localStorage and shows a fallback status; if neither storage API is available it reports an explicit error.

The map also loads public live feeds in the browser: USGS earthquakes (last 24 hours) and OpenSky aircraft for the current map viewport. NASA FIRMS active-fire data is available when you enter a FIRMS `MAP_KEY` in the Live feeds panel. Provider limits, CORS restrictions, and unavailable keys are shown in the feed status instead of being hidden.

The workspace includes a globe-mode presentation inspired by public “God’s Eye View” dashboards: toggle Globe view, switch individual live layers, and inspect popups for each public event. It intentionally does not track people. Vessels and satellites are shown as “API needed” until a lawful provider is configured; no fake live data is generated.

## Run (static, no Node required)

Open `index.html` directly, or publish the repository with GitHub Pages, Netlify, Cloudflare Pages, or another static host. Map, evidence capture, IndexedDB persistence, timeline, and JSON backup/restore work without Node.

For GitHub Pages, enable **Settings → Pages → Source: GitHub Actions** once. The included `.github/workflows/pages.yml` then publishes the static workspace on every push to `main`.

The optional local API can be run with Node.js 18 or newer:

```sh
npm start
```

Open <http://localhost:3000>. Static hosting does not provide `/api/analyze`; the UI reports that explicitly and continues to support all map/evidence features.

## Backup and online sync

Use **Export JSON** to download a portable case backup and **Restore** to import it on another device. The backup contains evidence points and timestamps, not API keys.

The optional **backup URL** fields support a simple endpoint you control: `POST` receives the JSON backup shown below, and `GET` must return the same object. This makes the static app compatible with a hosted function, WebDAV-compatible gateway, or private storage API without embedding a vendor credential in the browser.

```json
{"format":"intel-prime-evidence","version":1,"exportedAt":"2026-09-21T21:00:00.000Z","points":[]}
```

Only use an HTTPS endpoint with authentication handled by that endpoint (or a private network). Do not paste cloud access keys into the browser.

## Optional AI provider

Secrets are read only by `server.js`; they are never embedded in browser code. Configure exactly one provider:

```sh
# xAI's OpenAI-compatible endpoint
AI_PROVIDER=xai
XAI_API_KEY=your-key
XAI_MODEL=the-model-enabled-for-your-account

# Or Anthropic
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-key
ANTHROPIC_MODEL=the-model-enabled-for-your-account
```

Do not assume a model name: `XAI_MODEL` must be set to the model currently configured for the account. An unset provider or failed provider request returns an explicit error; there is no silent fallback. AI is optional and does not affect map/evidence capture.

## Map and attribution

MapLibre GL JS is loaded from its browser CDN and uses an OSM raster style from `tile.openstreetmap.org`. The UI displays a persistent OpenStreetMap attribution link. Follow OpenStreetMap's tile usage policy, cache where appropriate, and use a production tile provider for high-volume deployments.

## Security

Keep `.env`/secrets out of source control. The API validates request size and required fields, keeps keys server-side, returns provider errors without credentials, and sends only the selected evidence and user question to the configured provider. Evidence is local to the browser and should be treated as sensitive case data.
