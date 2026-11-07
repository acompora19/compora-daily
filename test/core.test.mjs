// Run with: TZ=America/New_York node test/core.test.mjs
import * as C from "../daily-core.js";
import ICAL from "../vendor/ical.min.js";

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("FAIL", msg); } else console.log("ok  ", msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

// holidays
const h26 = C.holidaysFor(2026);
eq(h26.find(h => h.key === "thanksgiving").d, 26, "Thanksgiving 2026 is Nov 26");
eq(h26.find(h => h.key === "labor").d, 7, "Labor Day 2026 is Sep 7");
eq(h26.find(h => h.key === "memorial").d, 25, "Memorial Day 2026 is May 25");
eq([h26.find(h => h.key === "easter").m, h26.find(h => h.key === "easter").d], [3, 5], "Easter 2026 is Apr 5");
eq(h26.find(h => h.key === "mothers").d, 10, "Mother's Day 2026 is May 10");

// trash: Monday pickup, holiday slide
const cfg = { ...C.TRASH_DEFAULT, day: 1, recycleAnchor: "2026-11-02" };   // the Monday route, for these checks
const p = C.pickups(new Date(2026, 8, 1), 2, cfg);
eq(C.dayKey(p[0].date), "2026-09-08", "first pickup after Sep 1 is Tue Sep 8 (Labor Day week)");
const lab = C.pickupInWeek(new Date(2026, 8, 7), cfg);
eq(C.dayKey(lab.date), "2026-09-08", "Labor Day week: pickup slides to Tuesday Sep 8");
ok(lab.shifted && lab.holiday.key === "labor", "slide is blamed on Labor Day");
const tg = C.pickupInWeek(new Date(2026, 10, 23), cfg);
eq(C.dayKey(tg.date), "2026-11-23", "Thanksgiving week: Monday pickup is not affected (holiday is after)");
const xmas = C.pickupInWeek(new Date(2026, 11, 21), cfg);
eq(C.dayKey(xmas.date), "2026-12-21", "Christmas 2026 (Friday) doesn't move a Monday pickup");
const thuCfg = { ...cfg, day: 4 };
eq(C.dayKey(C.pickupInWeek(new Date(2026, 10, 23), thuCfg).date), "2026-11-27", "Thursday pickup slides to Friday on Thanksgiving");
eq(C.dayKey(C.pickupInWeek(new Date(2026, 11, 21), thuCfg).date), "2026-12-24", "Thursday pickup the week of Christmas (Fri) is not moved");
// every-other-week recycling counted from the anchor week
const alt = { ...cfg, recycle: "even", recycleAnchor: "2026-11-02" };
eq(C.pickups(new Date(2026, 10, 2), 3, alt).map(x => x.recycling), [true, false, true], "every-other-week recycling from Nov 2");
// city default: Thursday; Thanksgiving week slides to Friday; a city notice can move a week
eq(C.dayKey(C.pickupInWeek(new Date(2026, 10, 23)).date), "2026-11-27", "default (Thursday) slides to Friday on Thanksgiving");
const mv = { ...C.TRASH_DEFAULT, moved: C.movedFromNotices([{ movedTo: "2026-12-26" }]) };
const xw = C.pickupInWeek(new Date(2026, 11, 21), mv);
eq([C.dayKey(xw.date), xw.moved, xw.shifted], ["2026-12-26", true, true], "a city notice moves Christmas-week pickup to Saturday");
eq(C.trashEvents(new Date(2026, 11, 21), new Date(2026, 11, 28), mv)[0].note, "Moved per a city notice", "moved pickup says why");
// found-in-email items become board events in local time
const fe = C.foundToEvent({ id: "x", title: "Mia's dentist", date: "2026-11-12", time: "15:00", end: null, who: "mia" });
eq([C.dayKey(fe.start), new Date(fe.start).getHours(), (fe.end - fe.start) / C.HOUR, fe.cal, fe.allDay], ["2026-11-12", 15, 1, "mia", false], "timed find → 1-hour event on Mia's color");
eq(C.foundToEvent({ id: "y", title: "Picture day", date: "2026-11-20", time: null, who: "nobody" }).cal, "mail", "unknown who → mail color");
eq(C.foundToEvent({ id: "z", title: "bad", date: "soon" }), null, "bad date → null");
// Day Out events for the town
const tw = C.townEvents([{ id: "cw-1", title: "Kid Zone", start: "2026-11-04T09:00-05:00", end: "2026-11-04T11:00-05:00", town: "Canal Winchester", source: "City of Canal Winchester" },
  { id: "dtc-1", title: "Gallery Hop", start: "2026-11-07T16:00-05:00", town: "Columbus" }], "Canal Winchester", new Date(2026, 10, 1), new Date(2026, 11, 1));
eq(tw.map(e => e.title), ["Kid Zone"], "only Canal Winchester events come through");
eq(tw[0].cal, "town", "town color");
// notices
const sunEve = new Date(2026, 10, 1, 18, 0);   // Sunday 6 PM
eq(C.trashNotice(sunEve, cfg)?.line, "Trash & recycling out tonight", "Sunday evening says out tonight");
eq(C.trashNotice(new Date(2026, 10, 2, 7), cfg)?.line, "Trash & recycling day", "Monday morning says trash day");
eq(C.trashNotice(new Date(2026, 10, 2, 14), cfg), null, "Monday afternoon says nothing");
eq(C.trashNotice(new Date(2026, 10, 4, 14), cfg), null, "Wednesday says nothing");
eq(C.trashNotice(new Date(2026, 8, 6, 18), cfg)?.line, "No trash tonight", "Sunday before Labor Day says don't put it out");
eq(C.trashNotice(new Date(2026, 8, 7, 18), cfg)?.line, "Trash & recycling out tonight", "Labor Day evening says out tonight");
eq(C.trashEvents(new Date(2026, 10, 1), new Date(2026, 10, 30), cfg).length, 4, "four pickups in November 2026");

// ICS parsing: a weekly recurring event in Eastern time with one moved occurrence and one cancelled one, plus an all-day event
const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20261105T160000
DTEND;TZID=America/New_York:20261105T170000
RRULE:FREQ=WEEKLY;BYDAY=TH
EXDATE;TZID=America/New_York:20261119T160000
UID:gym@test
SUMMARY:Gymnastics
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20261113T100000
DTEND;TZID=America/New_York:20261113T110000
RECURRENCE-ID;TZID=America/New_York:20261112T160000
UID:gym@test
SUMMARY:Gymnastics (moved)
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261120
DTEND;VALUE=DATE:20261121
UID:pic@test
SUMMARY:Picture day
END:VEVENT
BEGIN:VEVENT
DTSTART:20261110T230000Z
DTEND:20261111T000000Z
UID:utc@test
SUMMARY:Late call
END:VEVENT
END:VCALENDAR`;
const evs = C.icsToEvents(ICAL, ics, "mia", new Date(2026, 10, 1), new Date(2026, 11, 1));
const gym = evs.filter(e => /Gymnastics/.test(e.title));
eq(gym.map(e => C.dayKey(e.start)), ["2026-11-05", "2026-11-13", "2026-11-26"], "weekly Thursdays in Nov, one moved to Fri the 13th, one cancelled");
eq(gym.map(e => new Date(e.start).getHours()), [16, 10, 16], "times are read in Eastern time (4 PM, moved one 10 AM)");
eq(gym[1].title, "Gymnastics (moved)", "the moved occurrence uses its own title");
const pic = evs.find(e => e.title === "Picture day");
ok(pic && pic.allDay && C.dayKey(pic.start) === "2026-11-20", "all-day event lands on the right day");
const utc = evs.find(e => e.title === "Late call");
eq([C.dayKey(utc.start), new Date(utc.start).getHours()], ["2026-11-10", 18], "UTC times convert to local (6 PM EST)");
eq(C.eventsOnDay(evs, new Date(2026, 10, 13)).map(e => e.title), ["Gymnastics (moved)"], "eventsOnDay picks the moved one");

// month grid
const g = C.monthGrid(2026, 10);
eq([C.dayKey(g[0]), g.length], ["2026-11-01", 42], "November 2026 grid starts Sunday Nov 1");

// weather summary
const hrs = Array.from({ length: 24 }, (_, i) => ({ t: new Date(2026, 10, 3, i).getTime(), temp: 40 + i, feels: 38 + i, pop: i === 15 ? 70 : 0, precip: i === 15 ? 0.2 : 0, snow: 0, code: i === 15 ? 61 : 1, wind: 5, gust: 10, uv: 2 }));
eq(C.daySummary(hrs).glyph, "🌧", "rainy afternoon gets the rain glyph");
eq(C.gearFor(hrs[9], hrs.slice(10)), "rainy", "Beavy wears rain gear when rain is ahead");

console.log(fails ? `\n${fails} FAILED` : "\nall good");
process.exit(fails ? 1 : 0);
