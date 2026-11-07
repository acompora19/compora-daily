// daily-core.js: the date, calendar, trash-day, holiday and weather logic behind Compora Daily (index.html).
// Pure functions only: no page, no network. Everything is in the browser's local time (Columbus).
// The calendar reader takes ical.js (vendor/ical.min.js) as an argument so this file stays test-able on its own.
const HOUR = 3600000, DAY = 86400000;
const DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DNL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MNL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HOME = { name: "Canal Winchester", lat: 39.843, lon: -82.805 };

// ---------- dates ----------
function dayKey(d) { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function fromKey(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
function startOfDay(d) { d = new Date(d); d.setHours(0, 0, 0, 0); return d; }
function addDays(d, n) { d = new Date(d); d.setDate(d.getDate() + n); return d; }
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY); }
function fmtClock(d) { d = new Date(d); let h = d.getHours(); const m = d.getMinutes(); const ap = h < 12 ? "AM" : "PM"; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, "0")} ${ap}` : `${h} ${ap}`; }
function fmtShortClock(d) { d = new Date(d); let h = d.getHours(); const m = d.getMinutes(); const ap = h < 12 ? "a" : "p"; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`; }
function fmtDay(d, now = new Date()) {
  d = new Date(d);
  const diff = daysBetween(now, d);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return `${DN[d.getDay()]} ${MN[d.getMonth()]} ${d.getDate()}`;
}
function fmtLongDay(d) { d = new Date(d); return `${DNL[d.getDay()]}, ${MNL[d.getMonth()]} ${d.getDate()}`; }
// "Tonight", "tomorrow", "Thursday", "a week from Monday"
function fmtRelativeDay(d, now = new Date()) {
  const diff = daysBetween(now, d);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff > 1 && diff < 7) return DNL[new Date(d).getDay()];
  return `${DN[new Date(d).getDay()]} ${MN[new Date(d).getMonth()]} ${new Date(d).getDate()}`;
}

// ---------- the people on the board ----------
// Each calendar the Worker returns is matched to one of these by id (the part after CAL_ in the Worker's settings,
// lowercased). Anything else gets the "other" color. Change names and colors here.
const PEOPLE = {
  tony:   { name: "Tony",   color: "#2B4C7E", dark: "#8FB3E6" },
  mom:    { name: "Mom",    color: "#A6437A", dark: "#E39BC4" },
  mia:    { name: "Mia",    color: "#C98A1B", dark: "#F0C45A" },
  family: { name: "Family", color: "#2E6A5F", dark: "#72B5A7" },
  holiday:{ name: "Holidays", color: "#B0432B", dark: "#E3806A" },
  house:  { name: "House",  color: "#6B6256", dark: "#A8977A" },
  town:   { name: "Town",   color: "#5B6B2F", dark: "#B5C46A" },
  mail:   { name: "From email", color: "#7A5C2E", dark: "#D1A86A" },
  other:  { name: "Other",  color: "#555",    dark: "#bbb" },
};
function personFor(id) { return PEOPLE[id] || { ...PEOPLE.other, name: id.charAt(0).toUpperCase() + id.slice(1) }; }

// ---------- holidays ----------
function easter(y) {   // Western Easter: [month 0-11, day]
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31);
  return [mo - 1, ((h + l - 7 * m + 114) % 31) + 1];
}
// nth weekday of a month (n = -1 for the last one): day of month
function nthWeekday(y, m, weekday, n) {
  if (n > 0) { const first = new Date(y, m, 1).getDay(); return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7; }
  const last = new Date(y, m + 1, 0); return last.getDate() - ((last.getDay() - weekday + 7) % 7);
}
// Every holiday on the board for a year. "shift" marks the ones the trash hauler takes off (pickup slides a day).
// "art" matches Beavy's holiday pictures (holiday-<key>.webp).
function holidaysFor(y) {
  const [em, ed] = easter(y);
  return [
    { key: "newyear", name: "New Year's Day", m: 0, d: 1, emoji: "🎉", shift: true, art: true },
    { key: "mlk", name: "MLK Day", m: 0, d: nthWeekday(y, 0, 1, 3), emoji: "✊" },
    { key: "valentine", name: "Valentine's Day", m: 1, d: 14, emoji: "❤️", art: true },
    { key: "presidents", name: "Presidents' Day", m: 1, d: nthWeekday(y, 1, 1, 3), emoji: "🎩" },
    { key: "stpatrick", name: "St. Patrick's Day", m: 2, d: 17, emoji: "☘️", art: true },
    { key: "easter", name: "Easter", m: em, d: ed, emoji: "🐣", art: true },
    { key: "mothers", name: "Mother's Day", m: 4, d: nthWeekday(y, 4, 0, 2), emoji: "💐" },
    { key: "memorial", name: "Memorial Day", m: 4, d: nthWeekday(y, 4, 1, -1), emoji: "🇺🇸", shift: true },
    { key: "fathers", name: "Father's Day", m: 5, d: nthWeekday(y, 5, 0, 3), emoji: "🎣" },
    { key: "juneteenth", name: "Juneteenth", m: 5, d: 19, emoji: "🎊" },
    { key: "july4", name: "Fourth of July", m: 6, d: 4, emoji: "🎆", shift: true, art: true },
    { key: "labor", name: "Labor Day", m: 8, d: nthWeekday(y, 8, 1, 1), emoji: "🛠️", shift: true },
    { key: "halloween", name: "Halloween", m: 9, d: 31, emoji: "🎃", art: true },
    { key: "veterans", name: "Veterans Day", m: 10, d: 11, emoji: "🎖️" },
    { key: "thanksgiving", name: "Thanksgiving", m: 10, d: nthWeekday(y, 10, 4, 4), emoji: "🦃", shift: true, art: true },
    { key: "christmaseve", name: "Christmas Eve", m: 11, d: 24, emoji: "🎄", art: "christmas" },
    { key: "christmas", name: "Christmas", m: 11, d: 25, emoji: "🎄", shift: true, art: true },
    { key: "nye", name: "New Year's Eve", m: 11, d: 31, emoji: "🥂", art: "newyear" },
  ].map(h => ({ ...h, y, date: new Date(y, h.m, h.d), key: h.key }));
}
function holidayOn(d) { d = new Date(d); return holidaysFor(d.getFullYear()).find(h => h.m === d.getMonth() && h.d === d.getDate()) || null; }
// Beavy's outfit: the next holiday with a picture, within two weeks (same rule as Mia's Almanac).
function holidayFor(now = new Date()) {
  const y = now.getFullYear();
  const next = [...holidaysFor(y), ...holidaysFor(y + 1)].filter(h => h.art).map(h => ({ ...h, days: daysBetween(now, h.date) }))
    .filter(h => h.days >= 0 && h.days <= 13 && (h.days === 0 || !/Eve$/.test(h.name))).sort((a, b) => a.days - b.days)[0];
  if (!next) return null;
  return { ...next, today: next.days === 0, artKey: next.art === true ? next.key : next.art };
}
// Holidays as all-day events for the calendar grid.
function holidayEvents(fromDate, toDate) {
  const out = [];
  for (let y = new Date(fromDate).getFullYear(); y <= new Date(toDate).getFullYear(); y++)
    for (const h of holidaysFor(y)) if (h.date >= startOfDay(fromDate) && h.date < toDate)
      out.push({ id: `hol-${y}-${h.key}`, cal: "holiday", title: `${h.emoji} ${h.name}`, start: h.date.getTime(), end: h.date.getTime() + DAY, allDay: true, holiday: h.key });
  return out;
}

// ---------- trash day ----------
// cfg: { day: 0-6 (pickup weekday), recycle: "same" | "even" | "odd" | "none", recycleAnchor: "YYYY-MM-DD", shift: true, moved: { "YYYY-MM-DD (week's Monday)": "YYYY-MM-DD" } }
// "even"/"odd": recycling every other week; the anchor is a date recycling WAS picked up, so the app can count weeks from it.
// "moved": weeks where the city/hauler announced a different pickup date (filled in from the city's alerts by the skimmer).
// Default is the City of Canal Winchester's contract: Rumpke, Thursdays, recycling every week, pickup slides a day when
// a holiday falls earlier in the week (canalwinchesterohio.gov/477/Trash-and-Recycling-Service).
const TRASH_DEFAULT = { day: 4, recycle: "same", recycleAnchor: "2026-11-05", shift: true, moved: {} };
// Monday of the week a date is in.
function weekStart(d) { d = startOfDay(d); return addDays(d, -((d.getDay() + 6) % 7)); }
// The real pickup date for a given week: the scheduled weekday, pushed a day if a hauler holiday falls on a weekday
// earlier in that week or on the day itself (the usual "everything slides one day after the holiday" rule).
function pickupInWeek(weekMonday, cfg = TRASH_DEFAULT) {
  const sched = addDays(weekMonday, (cfg.day + 6) % 7);
  let hol = null;
  if (cfg.shift) {
    for (let i = 0; i <= (cfg.day + 6) % 7; i++) {
      const h = holidayOn(addDays(weekMonday, i));
      if (h && h.shift && addDays(weekMonday, i).getDay() >= 1 && addDays(weekMonday, i).getDay() <= 5) hol = h;
    }
  }
  let date = hol ? addDays(sched, 1) : sched;
  const movedTo = cfg.moved && cfg.moved[dayKey(weekMonday)];
  const moved = !!movedTo && dayKey(date) !== movedTo;
  if (movedTo) date = fromKey(movedTo);
  let recycling = cfg.recycle === "same";
  if (cfg.recycle === "even" || cfg.recycle === "odd") {
    const anchorWeek = weekStart(fromKey(cfg.recycleAnchor || "2026-11-02"));
    const weeks = Math.round((weekMonday - anchorWeek) / (7 * DAY));
    recycling = ((weeks % 2) + 2) % 2 === 0;   // every other week, counting from the anchor week
  }
  return { date, recycling, shifted: !!hol || moved, holiday: moved ? { name: "the city's notice", key: "notice" } : hol, moved };
}
// Pickups from a date onward (n of them).
function pickups(from, n = 6, cfg = TRASH_DEFAULT) {
  const out = []; let wk = weekStart(from);
  while (out.length < n) { const p = pickupInWeek(wk, cfg); if (p.date >= startOfDay(from)) out.push(p); wk = addDays(wk, 7); }
  return out;
}
// What to say on the board right now about trash. Returns null when there's nothing worth saying.
//   The evening before (from 4 PM): "Trash out tonight" (the headline of the day).
//   The morning of (until noon): "Trash day" (in case it's not at the curb yet).
function trashNotice(now = new Date(), cfg = TRASH_DEFAULT) {
  const next = pickups(now, 2, cfg)[0];
  const diff = daysBetween(now, next.date), hr = now.getHours();
  const what = next.recycling ? "Trash & recycling" : "Trash";
  if (diff === 1 && hr >= 16) return { level: "hot", line: `${what} out tonight`, sub: next.shifted ? `A day late this week for ${next.holiday.name}` : "", ...next };
  if (diff === 0 && hr < 12) return { level: "hot", line: `${what} day`, sub: next.shifted ? `Pushed to ${DNL[next.date.getDay()]} for ${next.holiday.name}` : "Is it at the curb?", ...next };
  if (diff === 0) return null;
  if (diff === 1) return { level: "soon", line: `${what} goes out tonight`, sub: next.shifted ? `A day late this week for ${next.holiday.name}` : "", ...next };
  // the usual trash night, but the holiday pushed pickup: say so before someone drags the cans out
  if (next.shifted && diff === 2 && hr >= 16) return { level: "hot", line: "No trash tonight", sub: `Pickup is ${DNL[next.date.getDay()]} this week for ${next.holiday.name}`, ...next };
  if (next.shifted && diff <= 6) return { level: "note", line: `${what} is ${DNL[next.date.getDay()]} this week`, sub: `Pushed a day for ${next.holiday.name}`, ...next };
  return null;
}
// Trash pickups as all-day events for the calendar grid.
function trashEvents(fromDate, toDate, cfg = TRASH_DEFAULT) {
  return pickups(fromDate, 20, cfg).filter(p => p.date < toDate).map(p => ({
    id: `trash-${dayKey(p.date)}`, cal: "house", title: p.recycling ? "🗑️ Trash & recycling" : "🗑️ Trash", start: p.date.getTime(), end: p.date.getTime() + DAY, allDay: true, trash: true,
    note: p.moved ? "Moved per a city notice" : p.shifted ? `A day late for ${p.holiday.name}` : "",
  }));
}
// Turn the skimmer's city notices into the "moved" map: notice says pickup is on date X → the week containing X uses X.
function movedFromNotices(notices = []) {
  const moved = {};
  for (const n of notices) if (n && n.movedTo && /^\d{4}-\d{2}-\d{2}$/.test(n.movedTo)) moved[dayKey(weekStart(fromKey(n.movedTo)))] = n.movedTo;
  return moved;
}

// ---------- events found in email (skimmer) and accepted onto the board ----------
// Items carry date "YYYY-MM-DD" and time "HH:MM" | null in Columbus time; this turns one into a board event.
function foundToEvent(it, cal = "mail") {
  if (!it || !/^\d{4}-\d{2}-\d{2}$/.test(it.date || "")) return null;
  const d = fromKey(it.date);
  const hm = s => (typeof s === "string" && /^\d{1,2}:\d{2}$/.test(s)) ? s.split(":").map(Number) : null;
  const t0 = hm(it.time), t1 = hm(it.end);
  const start = t0 ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), t0[0], t0[1]).getTime() : d.getTime();
  let end = t1 ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), t1[0], t1[1]).getTime() : (t0 ? start + HOUR : start + DAY);
  if (end <= start) end = start + (t0 ? HOUR : DAY);
  return { id: `found-${it.id}`, cal: it.who && PEOPLE[it.who] ? it.who : cal, title: it.title, start, end, allDay: !t0, location: it.location || "",
    desc: [it.note, it.from ? `Found in email from ${it.from}` : "", it.subject ? `"${it.subject}"` : ""].filter(Boolean).join("\n"), found: true };
}
// Day Out's events.json → board events for our town (the "Town" calendar).
function townEvents(dayOutEvents = [], town = "Canal Winchester", from, to) {
  const out = [];
  for (const e of dayOutEvents) {
    const hay = `${e.town || ""} ${e.venue || ""} ${e.address || ""}`.toLowerCase();
    if (!hay.includes(town.toLowerCase())) continue;
    const start = new Date(e.start).getTime(), end = e.end ? new Date(e.end).getTime() : start + (e.allDay ? DAY : 2 * HOUR);
    if (!(start > 0) || start >= to.getTime() || end <= from.getTime()) continue;
    out.push({ id: `town-${e.id}`, cal: "town", title: e.title, start, end, allDay: !!e.allDay, location: (e.venue || e.address || "").trim(),
      desc: [e.cost ? `Cost: ${e.cost}` : "", e.source ? `From ${e.source} (via Beavy's Day Out)` : ""].filter(Boolean).join("\n"), url: e.url, town: true });
  }
  return out;
}

// ---------- reading Google Calendar (iCal) with ical.js ----------
// icsToEvents(ICAL, icsText, calId, from, to) -> events in the window, recurrences expanded, exceptions applied.
// Each event: { id, cal, title, start (ms), end (ms), allDay, location, desc, uid }
function icsToEvents(ICAL, text, calId, from, to) {
  const out = [];
  let comp;
  try { comp = new ICAL.Component(ICAL.parse(text)); } catch (e) { return out; }
  for (const tz of comp.getAllSubcomponents("vtimezone")) {
    try { const z = new ICAL.Timezone(tz); if (!ICAL.TimezoneService.has(z.tzid)) ICAL.TimezoneService.register(z.tzid, z); } catch {}
  }
  const vevents = comp.getAllSubcomponents("vevent");
  // group by UID: one main event plus its exceptions (RECURRENCE-ID)
  const byUid = new Map();
  for (const v of vevents) {
    const uid = v.getFirstPropertyValue("uid") || Math.random().toString(36).slice(2);
    if (!byUid.has(uid)) byUid.set(uid, { main: null, exceptions: [] });
    const g = byUid.get(uid);
    if (v.hasProperty("recurrence-id")) g.exceptions.push(v); else g.main = v;
  }
  const winStart = from.getTime(), winEnd = to.getTime();
  const rangeStart = ICAL.Time.fromJSDate(new Date(winStart), true);
  for (const [uid, g] of byUid) {
    const mainComp = g.main || g.exceptions[0];
    if (!mainComp) continue;
    let ev;
    try { ev = new ICAL.Event(mainComp, { exceptions: g.main ? g.exceptions : g.exceptions.slice(1) }); } catch { continue; }
    const status = (mainComp.getFirstPropertyValue("status") || "").toUpperCase();
    if (status === "CANCELLED") continue;
    const push = (start, end, item, idx) => {
      const allDay = !!(start && start.isDate);
      const s = start.toJSDate().getTime();
      let e = end ? end.toJSDate().getTime() : s + (allDay ? DAY : HOUR);
      if (e <= s) e = s + (allDay ? DAY : HOUR);
      if (e <= winStart || s >= winEnd) return;
      if (((item.component || item).getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED") return;
      const src = item.component || item;
      out.push({ id: `${calId}-${uid}-${idx}`, uid, cal: calId, title: String(item.summary || src.getFirstPropertyValue("summary") || "(no title)"),
        start: s, end: e, allDay, location: String(item.location || src.getFirstPropertyValue("location") || ""), desc: String(item.description || src.getFirstPropertyValue("description") || "").slice(0, 600) });
    };
    if (ev.isRecurring()) {
      let it;
      try { it = ev.iterator(); } catch { continue; }
      let next, n = 0;
      // skip quickly to the window, then stop once past it
      while ((next = it.next()) && n < 2000) {
        n++;
        let det;
        try { det = ev.getOccurrenceDetails(next); } catch { continue; }
        const s = det.startDate.toJSDate().getTime();
        if (s >= winEnd) break;
        push(det.startDate, det.endDate, det.item, dayKey(s));
      }
    } else {
      push(ev.startDate, ev.endDate, ev, "0");
    }
  }
  return out.sort((a, b) => a.start - b.start || (b.allDay - a.allDay));
}

// ---------- laying events out ----------
// Events that touch a local calendar day (all-day and multi-day events show on each day they cover).
function eventsOnDay(events, d) {
  const a = startOfDay(d).getTime(), b = a + DAY;
  return events.filter(e => e.start < b && e.end > a).sort((x, y) => (y.allDay - x.allDay) || (x.start - y.start));
}
// Short time label for a chip: "" for all-day, "3p", "3:30p", "10a–noon" style is too long for the grid, so start only.
function chipTime(e) { return e.allDay ? "" : fmtShortClock(e.start); }
function timeRange(e) {
  if (e.allDay) { const days = Math.round((e.end - e.start) / DAY); return days > 1 ? `All day, ${days} days` : "All day"; }
  return `${fmtClock(e.start)} – ${fmtClock(e.end)}`;
}
// The next few things coming up from "now", for the Today column: today's remaining events, then tomorrow's, up to n.
function upNext(events, now = new Date(), n = 6) {
  const t = now.getTime();
  return events.filter(e => e.end > t && !e.trash && e.start < t + 7 * DAY).sort((a, b) => a.start - b.start).slice(0, n);
}
// Month grid: 6 rows x 7 days starting on the Sunday on/before the 1st.
function monthGrid(year, month) {
  const first = new Date(year, month, 1), start = addDays(first, -first.getDay()), days = [];
  for (let i = 0; i < 42; i++) days.push(addDays(start, i));
  return days;
}

// ---------- weather (a trimmed copy of Mia's Almanac so Beavy dresses the same on every app) ----------
function parseOpenMeteo(om) {
  const H = om.hourly;
  return H.time.map((s, i) => ({
    t: new Date(s).getTime(), temp: H.temperature_2m[i], feels: H.apparent_temperature[i],
    pop: H.precipitation_probability[i] ?? 0, precip: H.precipitation[i] ?? 0, snow: H.snowfall[i] ?? 0,
    code: H.weather_code[i], wind: H.wind_speed_10m[i], gust: H.wind_gusts_10m[i], uv: H.uv_index[i] ?? 0,
  })).filter(h => h.temp != null);
}
function dayHours(hours, d) { const k = dayKey(d); return hours.filter(h => dayKey(h.t) === k); }
function dressTemp(cur, hrs) {
  const out = hrs.filter(x => x.t >= cur.t - HOUR / 2 && new Date(x.t).getHours() >= 7 && new Date(x.t).getHours() <= 20);
  return Math.min(cur.feels ?? cur.temp, ...out.map(x => x.feels ?? x.temp));
}
const GEAR_NAME = {
  extreme: "Bitter cold: heavy coat & goggles", snowy: "Cold: warm coat, trapper hat & scarf",
  rainy: "Rainy: rain jacket, hood up", windy: "Windy: windbreaker & cap",
  hot: "Hot: tank top, sun hat & water", sunny: "Sunny & warm: sun hat & shades",
  fall: "Cool: flannel & beanie", spring: "Jacket weather: jacket & cap",
};
function gearFor(cur, ahead = []) {
  const hrs = [cur, ...ahead];
  const snowingNow = (cur.code >= 71 && cur.code <= 77) || cur.code === 85 || cur.code === 86;
  const rainingNow = !snowingNow && cur.code >= 51;
  const snowAhead = hrs.reduce((a, x) => a + (x.snow || 0), 0) >= 0.2;
  const rainAhead = hrs.some(x => x.pop >= 20);
  const gustAhead = Math.max(...hrs.map(x => x.gust || 0));
  const hiAhead = Math.max(...hrs.map(x => x.temp));
  const feel = dressTemp(cur, hrs);
  if (feel <= 15) return "extreme";
  if (snowingNow || snowAhead || feel <= 40) return "snowy";
  if (rainingNow || rainAhead) return "rainy";
  if (feel <= 52) return "spring";
  if (cur.gust >= 28 || cur.wind >= 18 || gustAhead >= 32) return "windy";
  if (hiAhead >= 86) return "hot";
  if (hiAhead >= 75 || (hiAhead >= 70 && feel >= 62 && cur.code <= 2)) return "sunny";
  return "fall";
}
// "Beavy says to wear…" for Mia, from Mia's Almanac.
const WEAR = {
  extreme: "her biggest puffy coat, a warm hat, mittens, and boots. Brrr, stay cozy!",
  snowy: "a winter coat, hat, mittens, and snow boots.",
  rainy: "a raincoat and rain boots. Puddle jumping allowed!",
  windy: "a zipped-up jacket. Hold on to your hat, it's breezy!",
  hot: "shorts, a t-shirt, sunscreen, and lots of water.",
  sunny: "a t-shirt and sunglasses. Don't forget sunscreen!",
  fall: "long sleeves and a cozy sweatshirt.",
  spring: "a jacket. It's a little chilly!",
};
function wearFor(gear, hours, now = new Date()) {
  const t = now.getTime();
  const i0 = Math.max(0, hours.findIndex(h => h.t + HOUR > t));
  const next = hours.slice(i0, i0 + 12);
  let line = WEAR[gear] || WEAR.fall;
  if (!next.length) return line;
  const cur = next[0];
  const feel = dressTemp(cur, dayHours(hours, cur.t));
  const snowToday = next.some(h => h.snow >= 0.1);
  if (gear === "snowy") line = feel <= 32 ? "a winter coat, a warm hat, and mittens." : "a warm coat and a hat. It's cold out there!";
  if (gear === "snowy" && snowToday) line += " Snow boots too!";
  if (gear === "spring") line = feel <= 46 ? "a warm jacket. It's chilly out there!" : "a jacket. It's a little chilly!";
  if (gear === "rainy" && feel <= 50) line += " It's cold too, so wear something warm underneath.";
  const wetLater = next.slice(2).some(h => h.pop >= 20);
  const snowLater = next.slice(2).some(h => h.snow >= 0.1);
  const lowLater = Math.min(...next.map(h => h.temp));
  const uv = Math.max(...next.map(h => h.uv || 0));
  if (snowLater && gear !== "snowy" && gear !== "extreme") line += " Snow is coming later, so bring boots!";
  else if (wetLater && gear !== "rainy") line += " Rain later, so pack the rain boots.";
  else if (cur.temp - lowLater >= 15 && lowLater < 55 && gear !== "snowy" && gear !== "extreme") line += " It gets chilly later, so grab a jacket.";
  else if (uv >= 7 && gear !== "sunny" && gear !== "hot") line += " Strong sun today: sunscreen!";
  return line;
}
// One day's summary for the week columns: hi, lo, chance of rain, a glyph and a word.
function daySummary(hrs) {
  if (!hrs.length) return null;
  const day = hrs.filter(h => { const hr = new Date(h.t).getHours(); return hr >= 7 && hr <= 21; });
  const use = day.length ? day : hrs;
  const hi = Math.max(...hrs.map(h => h.temp)), lo = Math.min(...hrs.map(h => h.temp));
  const pop = Math.max(...use.map(h => h.pop)), precip = use.reduce((s, h) => s + h.precip, 0), snow = use.reduce((s, h) => s + h.snow, 0);
  const storm = use.some(h => h.code >= 95), cloud = use.map(h => Math.min(h.code, 3)).reduce((s, x) => s + x, 0) / use.length;
  let glyph, word;
  if (storm) { glyph = "⛈"; word = "Storms"; }
  else if (snow >= 0.3) { glyph = "❄️"; word = `Snow ${snow.toFixed(1)}"`; }
  else if (precip >= 0.1 || pop >= 60) { glyph = "🌧"; word = `Rain ${pop}%`; }
  else if (pop >= 30) { glyph = "🌦"; word = `${pop}% rain`; }
  else if (cloud >= 2.4) { glyph = "☁️"; word = "Cloudy"; }
  else if (cloud >= 1.2) { glyph = "⛅"; word = "Partly sunny"; }
  else { glyph = "☀️"; word = "Sunny"; }
  return { hi: Math.round(hi), lo: Math.round(lo), pop, glyph, word };
}
// What Beavy says about the day as a whole (same outlook as Day Out).
function outlookLine(hrs) {
  if (!hrs.length) return "";
  const day = hrs.filter(h => { const hr = new Date(h.t).getHours(); return hr >= 9 && hr <= 20; });
  const use = day.length ? day : hrs;
  const hi = Math.max(...use.map(h => h.temp)), pop = Math.max(...use.map(h => h.pop)), precip = use.reduce((s, h) => s + h.precip, 0);
  const snow = use.reduce((s, h) => s + h.snow, 0), feel = Math.min(...use.map(h => h.feels ?? h.temp));
  if (use.some(h => h.code >= 95)) return "Storms in the forecast. Keep an eye on the sky.";
  if (snow >= 0.5) return `Snow today (${snow.toFixed(1)}"). Boots by the door.`;
  if (pop >= 50 || precip >= 0.15) return `Rain likely (${pop}% chance). Umbrellas and rain boots.`;
  if (feel <= 25) return `Bitter cold (feels like ${Math.round(feel)}°). Bundle up and keep trips short.`;
  if (hi >= 95) return `Hot one (${Math.round(hi)}°). Water bottles for everybody.`;
  if (pop >= 30) return `Could sprinkle (${pop}% chance). A jacket with a hood wouldn't hurt.`;
  if (hi >= 60) return `${Math.round(hi)}° and dry. Great day to be outside.`;
  return `${Math.round(hi)}° and dry. Bundle up a little and get outside.`;
}

// ---------- sample events, for before the calendars are connected ----------
function sampleEvents(now = new Date()) {
  const d = n => addDays(startOfDay(now), n).getTime();
  const at = (n, h, m = 0) => d(n) + h * HOUR + m * 60000;
  const mk = (cal, title, start, end, extra = {}) => ({ id: `sample-${cal}-${start}`, cal, title, start, end, allDay: !!extra.allDay, location: extra.location || "", desc: "", sample: true });
  return [
    mk("family", "Mia's dentist", at(0, 15, 30), at(0, 16, 15), { location: "Canal Winchester" }),
    mk("tony", "Late at work", at(0, 17), at(0, 19)),
    mk("mom", "Book club", at(1, 19), at(1, 21)),
    mk("mia", "Picture day", d(2), d(3), { allDay: true }),
    mk("family", "Dinner at Grandma's", at(2, 17, 30), at(2, 20)),
    mk("tony", "Fishing with Tyler", at(5, 6), at(5, 13), { location: "Buckeye Lake" }),
    mk("mia", "Gymnastics", at(3, 16), at(3, 17)),
    mk("mia", "Gymnastics", at(10, 16), at(10, 17)),
    mk("family", "Pumpkin bread, Sunday baking", at(6, 10), at(6, 12)),
    mk("mom", "Hair appointment", at(8, 13), at(8, 14, 30)),
    mk("family", "Grizzy to the vet", at(9, 9), at(9, 10)),
    mk("tony", "Oil change", at(12, 8), at(12, 9)),
  ];
}

export { HOUR, DAY, DN, DNL, MN, MNL, HOME, PEOPLE, personFor, dayKey, fromKey, startOfDay, addDays, daysBetween, fmtClock, fmtShortClock, fmtDay, fmtLongDay, fmtRelativeDay,
  holidaysFor, holidayOn, holidayFor, holidayEvents, nthWeekday, TRASH_DEFAULT, weekStart, pickupInWeek, pickups, trashNotice, trashEvents, movedFromNotices, foundToEvent, townEvents,
  icsToEvents, eventsOnDay, chipTime, timeRange, upNext, monthGrid,
  parseOpenMeteo, dayHours, dressTemp, GEAR_NAME, gearFor, WEAR, wearFor, daySummary, outlookLine, sampleEvents };
