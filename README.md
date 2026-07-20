# Strava Calendar View

A static, fully client-side calendar view of your Strava activities. No server,
no database, no analytics — your data and credentials never leave your browser
except to talk directly to `strava.com`.

**Live site:** enable GitHub Pages for this repo (see below) and it's served at
`https://<username>.github.io/Strava-calendar-view/`.

## Two ways to load your data

### 1. Connect to Strava (live data)

Strava's OAuth flow normally requires a server to hold a client secret. This
site instead uses a **bring-your-own-app** flow: you create your own free
Strava API application and the browser does the whole OAuth dance itself.
Your client ID/secret are stored only in your browser's localStorage and are
only ever sent to `strava.com`.

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

- Month calendar with color-coded activity chips (grouped by sport), linking
  to the activity on Strava when loaded via the API
- Monthly totals per sport (count, distance, time, elevation)
- km/mi, Monday/Sunday week start, light/dark/system theme
- Hover tooltips with distance, time, pace, and elevation
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

## Privacy

- Credentials, tokens, and cached activities live in `localStorage` on your
  machine. "Disconnect & clear data" in Settings wipes everything.
- The only network requests the site makes are to `www.strava.com`.
