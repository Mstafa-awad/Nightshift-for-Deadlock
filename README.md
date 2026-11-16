# Nightshift — Deadlock Advisor (test build)

A standalone, lightweight, phone-first Deadlock item advisor. No Overwolf. No injection, memory reading, game file modification, or process monitoring.

## Quickest way to test

1. Extract this ZIP.
2. On Windows, double-click **START_WINDOWS.bat**.
3. Open **http://localhost:8765** in your browser.
4. Start in **Preview** mode to test the interface with **explicitly simulated data**.
5. Switch to **Real stats** to request recent statistics from the community Deadlock API. Internet required for first fetch.

On a phone, deploy this folder on HTTPS (e.g. GitHub Pages). A phone cannot access `localhost` on your PC; if testing on your local Wi-Fi, browse to the PC's LAN address (but install/offline PWA needs HTTPS).

## Deploy on your phone with GitHub Pages (no software on your gaming PC)

**This ZIP has a combined deployment + monthly update workflow**. The earlier v0.2.1 workflow could write data files to the repository but did not explicitly deploy those data updates to GitHub Pages. This version fixes that.

1. Make a **public** repo on GitHub named `nightshift` (leave it empty).
2. Unzip this package. On your repo page use **Add file > Upload files** and drag **everything inside** the extracted folder (not the ZIP itself and not the enclosing folder). Keep `.github/workflows/nightshift.yml`. Confirm `index.html` is at the **repository root**. Commit the files to `main`.
3. **Settings > Pages > Build and deployment > Source: GitHub Actions** (not Deploy from a branch).
4. **Actions > Nightshift - Publish and Update > Run workflow** to perform the first upload/refresh. The push to `main` also triggers it automatically, but manual Run workflow is useful if Pages settings were configured later.
5. In **Settings > Pages**, click **Visit site**. Your site URL should resemble `https://USERNAME.github.io/nightshift/`. Open it on your phone, select **Add to Home Screen** (Chrome/Android menu; Safari/iPhone Share menu).
6. **Settings inside Nightshift > Save all known art**, while online, for cached hero/item artwork.

The workflow refreshes compact aggregated statistics on the **first of each month**, commits any new snapshots, and **deploys the updated site directly**. You do not need to run Python or the local HTTP server after publishing. Both the site and the scheduled updater run on GitHub's infrastructure (public repositories are free within GitHub's published terms and limits).

**If the first run fails:** open **Actions**, choose the failed workflow run, inspect the failing step. If the update script fails due to an API outage, it continues with the last saved data and deploys anyway. `REAL STATS` needs successful API snapshots (or direct API access); preview values are illustrative. If publishing is denied, verify **Settings > Pages > Source: GitHub Actions** and the repository Actions permissions.

## What works in this prototype

- Responsive phone / desktop interface, all 42 heroes from the 2026 roster, six-enemy picker, stage selector (0–9 / 9–20 / 20+ minutes), item price filter, persisted preferences.
- Public player-ID active-match search: SteamID3 and SteamID64 accepted (conversion done in the browser); if found in the **top 200 Watch-tab matches**, tries to automatically select heroes and opponents. Not a guaranteed tracker of ordinary matches.
- On-demand public aggregate **item-flow-stats** queries; combines adjusted win rate with observed sample size and item popularity, plus an optional weak enemy-specific signal when the API returns it.
- Local cache for hero statistics and item definitions; installable PWA with offline shell.
- Monthly per-hero JSON snapshot generator, no full game archives or match dumps. The client first loads snapshot files where present, otherwise makes direct API calls.
- Preview mode is **SIMULATED**: never use those numbers as real recommendations.

## Important limitations

1. This environment could verify the API **documentation** but could not make live requests to the API during packaging. Test the **Real stats** button using your own network; browser CORS rules, API outages, or schema changes may affect connectivity. It will show a clear error instead of invented real recommendations.
2. Data is **not** every Deadlock match. It is whatever historical sample the community API aggregates. The combined annual/30-day snapshots are statistically weighted estimates, not strictly causal item rankings.
3. If browser CORS is blocked, the free GitHub Actions snapshots are the recommended approach; the phone will then read same-origin static JSON rather than contacting the API directly for hero recommendations. Player-ID lookup still requires direct API browser access or a separately deployed proxy.
4. No third-party app can promise zero ban risk. This prototype only uses public HTTP APIs and does not run alongside or access the game client.
5. The first ZIP deliberately ships **without fabricated real match statistics**. Monthly snapshots are populated after the workflow runs.
6. Steam player ID is a *lookup key*, not an authenticated sign-in. The app never asks for a password.

## Technical notes

- Plain JavaScript, HTML and CSS; no npm, frameworks, tracking scripts or ads.
- Offline UI shell via service worker (HTTPS / localhost only); cached statistics stored in localStorage. Small JSON files per hero and a single catalog.
- Data endpoint documentation: https://api.deadlock-api.com/docs/
- `scripts/update_data.py` is Python 3 standard library only; `python scripts/update_data.py --hero 6 --quick` tests a single hero.
- The top-200 constraint is documented by `/v1/matches/active`.
- Data-driven rankings must not be treated as proof of the causal effectiveness of an item.

Independent fan project; not endorsed or affiliated with Valve.

## Visual UI update — v0.2

- Rebuilt in a gritty, vintage **Curiosity Shop**-inspired visual style, using weapon amber, vitality green and spirit purple.
- Large hero portrait, 6 visual enemy slots, hero gallery picker, pictorial **best next item**, six smaller ranked item cards, cost / win-rate glance, details on tap.
- Item and hero art fetched from community-maintained extracted game assets. Main asset source is [deadlock-open-assets](https://github.com/0xThiagoAmaral/deadlock-open-assets), with hero metadata from the Deadlock API where available. Copyright in original art remains with Valve.
- Images are only requested as they appear; the hosted PWA uses **CacheStorage** with a cache-first service worker (up to around 260 image URLs) to avoid repeatedly downloading the same artwork. A **Settings → Save all known art** action preloads discovered images for later offline use. Settings can clear that cache at any time.
- The single-file Quick Test also uses remote images, but cannot reliably install a service worker. Browser HTTP caching may apply; for **reliable offline artwork**, deploy the full PWA on **HTTPS**, open it once online, then preload the art in Settings. A PWA will not fetch art it has never downloaded while offline.
- For images absent from the source libraries, the interface deliberately shows a symbol/initial, not a random unrelated portrait. Missing / renamed items are also safely handled.
- Preview statistics are still simulated. Selecting Real stats loads real aggregate statistics when the API or published snapshots are available; the art cache does not turn example rankings into real recommendations.

Run: `node tests/test_core.cjs && node tests/test_art.cjs && python tests/test_updater.py`

## v0.2.1 — Empty database / 404 fix

The download includes valid empty `data/catalog.json` and `data/manifest.json` placeholders. The app reads `data/manifest.json` to find out which hero snapshots actually exist and only requests those. An empty manifest is intentional: no real statistics were included or invented. When the API is reachable the Real Stats mode still requests live aggregates directly.

To generate real snapshots on Windows while online (requires Python 3):

```powershell
py scripts/update_data.py --hero 67 --hero 52 --hero 18 --hero 6 --quick
```

Or build every hero's month/year aggregates via `py scripts/update_data.py`. If an API request fails, the script reports it, and the app may still use live APIs directly. Restart or reload the app after generating files. If replacing an older installation, clear the site's service worker cache or hard-refresh.
