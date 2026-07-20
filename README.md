# Strava Calendar View

A static, fully client-side calendar view of your Strava activities. No server,
no database, no analytics — your data and credentials never leave your browser
except to talk directly to `strava.com`.

**Live site:** enable GitHub Pages for this repo (see below) and it's served at
`https://<username>.github.io/Strava-calendar-view/`.

## Two ways to load your data

### 1. Connect to Strava (live data)

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

### 2. Drop in your Strava export (no setup)

1. On Strava: **Settings → My Account → Download or Delete Your Account →
   Get Started** (only step 2, "Download Request"), or use the
   [export page](https://www.strava.com/athlete/delete_your_account).
2. Strava emails you an archive; it contains `activities.csv`.
3. Drag the CSV onto the page (or use **Load CSV**).

Everything is parsed in the browser. Note: export timestamps are UTC, so an
activity near midnight can land on the neighboring day.

## Features

- Month calendar with color-coded activity chips (grouped by sport)
- Click an activity for a detail view: start time, distance, moving/elapsed
  time, avg/max speed, elevation, heart rate, power (avg/weighted/max, when
  available), the route on a map, and a link to the activity on Strava
- Route maps come from the Strava API's summary polyline (rendered with
  Leaflet + OpenStreetMap tiles); CSV-loaded activities have no route in
  the CSV, so they show stats only
- Monthly totals per sport (count, distance, time, elevation)
- km/mi, Monday/Sunday week start, light/dark/system theme
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
- Network requests go to `www.strava.com` (data), and — only when you open
  an activity's route map — `unpkg.com` (Leaflet) and
  `tile.openstreetmap.org` (map tiles).
