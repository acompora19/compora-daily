# Compora Daily

The family's wall calendar. One page that shows everyone's week from Google Calendar, the weather with Beavy dressed for it, trash day, holidays, and the grocery / to-do / dinner lists. Built to sit on a plugged-in tablet in the kitchen and to work on phones too. A sibling to [Mia's Almanac](https://github.com/acompora19/mias-almanac), [Beavy's Day Out](https://github.com/acompora19/beavys-day-out) and [Mangia Mangia](https://github.com/acompora19/mangia-mangia).

Live: https://acompora19.github.io/compora-daily/

## How it fits together

- **Google Calendar is where events live.** Tony, Mom, Mia and a shared "Family" calendar. Add things on your phone like you do now; the wall picks them up within five minutes.
- **A tiny Cloudflare Worker** (`worker/worker.js`) holds the calendars' secret iCal links and hands the calendar text to the page. The links never go in this repo.
- **Trash day and holidays are rules in code** (`daily-core.js`): pickup on Mondays, slides a day after a hauler holiday, recycling on a schedule you set in Setup.
- **Lists live in Firestore** (the shared Firebase project), so the tablet and every phone see the same grocery list.
- **Weather** comes from Open-Meteo with no key; Beavy's outfit rules are copied from Mia's Almanac.
- **The other apps** open inside the Apps tab, so the tablet is one home screen for everything.

## Files

- `index.html` is the whole app. `daily-core.js` holds the date, trash, holiday, calendar and weather logic (tests in `test/`).
- `vendor/ical.min.js` is [ical.js](https://github.com/kewisch/ical.js) (MPL-2.0), which reads Google's calendar format, repeats and all.
- `worker/worker.js` is the Cloudflare Worker. Paste it into a new Worker; see below.
- `firestore.rules` is the full rule set for the shared Firebase project with the `daily_board` collection added.
- `sw.js` and `manifest.json` make it install to a home screen and keep working offline. Bump `VERSION` in `sw.js` on every release.
- Beavy's pictures are copies from Mia's Almanac.

## Setup, step by step

### 1. Hosting (GitHub Pages)
Repo → **Settings → Pages** → Source: "Deploy from a branch", Branch: `main`, folder `/ (root)` → Save. A minute later the site is live at the link above, showing sample events.

### 2. The calendar Worker (Cloudflare, free)
1. Google Calendar on a computer → ⚙️ **Settings** → click a calendar on the left (yours first) → scroll to **Integrate calendar** → copy **Secret address in iCal format**. Do this for each calendar: Tony, Mom, Mia, Family. (If there's no "Family" calendar yet, make one: left side, "+" next to Other calendars → Create new calendar → share it with everyone's Google account.)
2. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker** → name it `compora-daily` → **Deploy**.
3. **Edit code** → delete what's there, paste all of `worker/worker.js` → **Deploy**.
4. Worker → **Settings → Variables and Secrets** → **Add**, type **Secret**, one per calendar:
   - `CAL_TONY` = the secret link for Tony's calendar
   - `CAL_MOM`, `CAL_MIA`, `CAL_FAMILY` the same way
   The name after `CAL_` picks the color on the board (tony, mom, mia, family). Anything else shows in gray.
5. Copy the Worker's address (looks like `https://compora-daily.YOURNAME.workers.dev`).
6. In the app, **Setup** (top right) → paste the address → Save. Or open `https://acompora19.github.io/compora-daily/?worker=PASTE-THE-ADDRESS` once on a device, which saves it.
7. To skip step 6 on every device: put the address in `WORKER_URL` at the top of the `<script>` in `index.html`.

### 3. Lists (Firestore)
Firebase console → the `mangia-mangia` project → **Firestore Database → Rules** → paste all of `firestore.rules` → **Publish**. (If the console shows rules for collections this file doesn't have, keep those and add just the `daily_board` block.) Until this is done the lists work on each device alone and say "Not synced".

### 4. Trash day
Setup → pick the pickup day and the recycling schedule. The default is Monday, recycling every week, pickup slides a day after a holiday. Each device keeps its own setting, so set it on the tablet.

### 5. The tablet
Any Android tablet with a browser. Install **Fully Kiosk Browser**, set the Start URL to the site, turn on "keep screen on", "hide status bar" and "reload on screen on", and set "return to start URL after idle" to a few minutes so it comes back from the Apps tab on its own. The page reloads itself at 3:30 AM every day to pick up updates.

## Adding events

- On a phone: add it to Google Calendar as usual. Pick the right calendar (yours, Mia's or Family) so it gets the right color.
- Tap a day on the wall → **+ Add to Google Calendar** opens the calendar with that day filled in (phones only).
- Google's "Events from Gmail" setting (Calendar → Settings → Events from Gmail) drops flights, reservations and appointments in on its own.

## Next up (not built yet)
- Email reader: a nightly GitHub Action that checks mail from the school, daycare, vet and such, asks the Worker's free AI for dates, and shows them in a "found in email" tray to accept or dismiss.
- Adding events from the tablet itself (needs a Google sign-in on the Worker).
- Tap-to-talk: "Mia's dentist Thursday at 3".

## Running the tests
```
TZ=America/New_York node test/core.test.mjs
```
