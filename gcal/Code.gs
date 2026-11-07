// Compora Daily → Google Calendar bridge (Google Apps Script).
//
// Runs as Tony's Google account, so it can add events to the family's calendars without any OAuth setup.
// The Worker calls this when someone taps Approve on an email find (or "Add to Google Calendar" on an event).
//
// SETUP (once):
//   1. script.google.com → New project → name it "Compora Daily" → replace the code with this file → Save.
//   2. Set KEY below to the same value as the Worker's WORKER_KEY secret.
//   3. Project Settings (gear) → Time zone: (GMT-05:00) Eastern Time.
//   4. Deploy → New deployment → type: Web app → Execute as: Me → Who has access: Anyone → Deploy → Authorize.
//   5. Copy the Web app URL and add it to the Worker as a secret named GCAL_HOOK.
//   Re-deploy (Deploy → Manage deployments → edit → new version) any time you change this file.

const KEY = "PASTE_THE_WORKER_KEY_HERE";
const DEFAULT_CALENDAR = "Family";          // where approved finds go unless the request names another calendar
const CALENDAR_BY_WHO = { tony: "Tony Compora", mom: "Family", mia: "Family", family: "Family" };

function doPost(e) {
  let body;
  try { body = JSON.parse((e.postData && e.postData.contents) || "{}"); } catch (err) { return out({ error: "bad json" }); }
  if (!body.key || body.key !== KEY) return out({ error: "bad key" });
  if (!body.title) return out({ error: "no title" });

  const wanted = body.calendar || CALENDAR_BY_WHO[body.who] || DEFAULT_CALENDAR;
  const cal = CalendarApp.getCalendarsByName(wanted)[0] || CalendarApp.getDefaultCalendar();
  const opts = { location: body.location || "", description: body.desc || "" };
  let ev;
  try {
    if (body.allDay) {
      const [y, m, d] = String(body.date).split("-").map(Number);
      ev = cal.createAllDayEvent(body.title, new Date(y, m - 1, d), opts);
    } else {
      ev = cal.createEvent(body.title, new Date(body.start), new Date(body.end), opts);
    }
  } catch (err) { return out({ error: "Calendar said: " + err.message }); }
  return out({ ok: true, id: ev.getId(), calendar: cal.getName(), title: ev.getTitle() });
}

// so a browser visit shows something friendly instead of an error
function doGet() { return out({ ok: true, hint: "Compora Daily calendar bridge is running. The Worker POSTs here." }); }

function out(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
