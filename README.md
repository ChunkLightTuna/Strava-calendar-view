# Strava Calendar View

A static, fully client-side calendar view of your Strava activities. No server,
no database, no analytics — your data and credentials never leave your browser
except to talk directly to `strava.com`.

**Live site: [strava.oeleri.ch](https://strava.oeleri.ch)**

(Forks: enable GitHub Pages as described below and your copy is served at
`https://<username>.github.io/Strava-calendar-view/`.)

## Three ways to load your data

### 1. Connect intervals.icu (live, free, any watch brand)

[intervals.icu](https://intervals.icu) is a free training platform that
auto-syncs from **Garmin, COROS, Wahoo, Suunto, Polar, Zwift** and more, and
its API is browser-accessible — so the calendar reads it live with no server
and no subscription:

1. Create a free intervals.icu account and link your watch platform under
   **Settings**.
2. In **Settings → Developer Settings**, copy your **Athlete ID** (like
   `i12345`) and **API Key**.
3. Click **Connect → intervals.icu** on the site and paste them in.

Activities arrive automatically as your watch syncs; route maps are fetched
from the activity's GPS stream when you open it. Credentials live only in
your browser's localStorage and are only ever sent to `intervals.icu`.

### 2. Connect to Strava (live data)

Strava's OAuth flow normally requires a server to hold a client secret. This
site instead uses a **bring-your-own-app** flow: you create your own Strava
API application and the browser does the whole OAuth dance itself. Your
client ID/secret are stored only in your browser's localStorage and are only
ever sent to `strava.com`.

> **Subscription required:** Strava's Developer Program requires the account
> that owns the API application to have an active Strava subscription.
> Without one the application is marked *inactive* and every API request
> fails with a 403 (`Application.Status: Inactive`) — even though creating
> the app and authorizing it appear to work. If you don't subscribe, use the
> CSV export option below instead; it needs no subscription.

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api) and
   create an application (any name, category, and website).
2. Set **Authorization Callback Domain** to the domain the site runs on,
   e.g. `<username>.github.io` (or `localhost` for local development).
   Domain only — no `https://`, no path.
3. Click **Connect Strava** on the site and paste your Client ID and Client
   Secret. You'll be sent to Strava to authorize, then back to the calendar.

Activities are fetched per month and cached in localStorage (past months
indefinitely, the current month for 15 minutes — or hit **Refresh**).

### 3. Drop in export files (no setup, no account)

Works with more than Strava — the page reads the standard activity file
formats every platform exports:

- **Strava**: the export ZIP or its `activities.csv` (details below)
- **Garmin**: the full account archive ZIP (from
  [garmin.com account management](https://www.garmin.com/account/datamanagement/)),
  or individual GPX/TCX/FIT files exported from Garmin Connect
- **COROS / Wahoo / Suunto / anything else**: export activities as
  GPX, TCX, or FIT (gzipped fine) and drop them in — multiple files at once
  work. Stats come from the FIT session summary or are derived from the
  trackpoints; sport type, HR, and power are picked up when present.

(Live-API connections for Garmin/COROS aren't possible from a static site —
Garmin's API is a gated business program and COROS has no public individual
API — so files are the path for those platforms.)

#### Strava export

1. On Strava: **Settings → My Account → Download or Delete Your Account →
   Get Started** (only step 2, "Download Request"), or use the
   [export page](https://www.strava.com/athlete/delete_your_account).
2. Strava emails you an archive (`export_<id>.zip`).
3. Drag the **whole ZIP** onto the page (or use **Load export**). Just the
   `activities.csv` from inside it works too, but the ZIP also gives you
   **route maps**, parsed from the archive's GPX/TCX/FIT files (gzipped
   ones included) when you open an activity.

Everything is parsed in the browser — the archive is read piecewise from
disk, so large exports are fine. Activity stats persist across reloads;
route maps need the ZIP, so re-drop it next visit if you want maps.
Note: export timestamps are UTC, so an activity near midnight can land on
the neighboring day.

## Features

- Month calendar with color-coded activity chips (grouped by sport)
- Click an activity for a detail view: start time, distance, moving/elapsed
  time, avg/max speed, elevation, heart rate, power (avg/weighted/max, when
  available), the route on a map, and a link to the activity on Strava
- Route maps come from the Strava API's summary polyline (rendered with
  Leaflet + OpenStreetMap tiles); CSV-loaded activities have no route in
  the CSV, so they show stats only
- Monthly totals per sport (count, distance, time, elevation)
- mi/km (miles by default), Sunday/Monday week start (Sunday by default),
  light/dark/system theme
- Hover tooltips with distance, time, speed/pace, HR, power, and elevation
- Demo mode so you can try it without any data

## Hosting on GitHub Pages

The included workflow (`.github/workflows/deploy-pages.yml`) publishes the
repo root on every push to `main`:

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run the workflow manually).

No build step — it's plain HTML/CSS/JS, so you can also just serve the
directory locally:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Custom domain (Cloudflare)

To serve the site from your own domain, in Cloudflare DNS:

- **Subdomain** (e.g. `cal.example.com`): add a `CNAME` record with name
  `cal` and target `<username>.github.io`.
- **Apex** (`example.com`): add four `A` records on `@` pointing to GitHub
  Pages' IPs: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
  `185.199.111.153` (optionally `AAAA` `2606:50c0:8000::153` … `:8003::153`).

Set the record to **DNS only** (grey cloud) — GitHub issues the TLS
certificate and proxying breaks the initial validation. Then in the repo:
**Settings → Pages → Custom domain**, enter the domain, wait for the cert,
and tick **Enforce HTTPS**. Verify the domain under your GitHub account
settings (Pages → Verified domains) to prevent takeovers. Remember your
Strava API app's **Authorization Callback Domain** must match the new
domain.

## Privacy

- Credentials, tokens, and cached activities live in `localStorage` on your
  machine. "Disconnect & clear data" in Settings wipes everything.
- Network requests go to `www.strava.com` and/or `intervals.icu` (whichever
  source you connect), and — only when you open an activity's route map —
  `unpkg.com` (Leaflet) and `tile.openstreetmap.org` (map tiles).
