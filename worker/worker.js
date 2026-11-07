// Compora Daily Worker (Cloudflare Workers, free tier). Two jobs:
//
//   GET  /events   The page can't read Google Calendar's secret iCal links directly (the links would be visible in the
//                  code, and Google doesn't allow browser requests to them). This fetches them and hands the calendar
//                  text to the page. Nothing is stored.
//   POST /extract  The email skimmer (a GitHub Action) sends the text of an email or a city alert here; the Worker's
//                  free AI pulls out any dated events and answers with JSON. Needs the shared key.
//   POST /calendar/add  The board sends an approved find here; the Worker passes it to the Google Apps Script bridge
//                  (gcal/Code.gs) which adds it to the family's Google Calendar.
//
// SETTINGS (Worker → Settings → Variables and Secrets), all type "Secret":
//   CAL_TONY    = https://calendar.google.com/calendar/ical/....../private-....../basic.ics
//   CAL_MOM, CAL_MIA, CAL_FAMILY = the same for each calendar
//   WORKER_KEY  = any long random string; the same value goes in the GitHub repo's secrets so only the skimmer can use /extract
//   GCAL_HOOK   = the Apps Script web app URL from gcal/Code.gs (https://script.google.com/macros/s/.../exec)
// Optional, type "Text":
//   ALLOWED_ORIGINS = https://acompora19.github.io,http://localhost:8000   (who may call /events; default is the GitHub Pages site)
// BINDING (Worker → Settings → Bindings → Add → Workers AI): variable name AI
//
// The part after CAL_ (lowercased) is the id the page uses to pick a color: tony, mom, mia, family.
// Where to find a secret iCal link: Google Calendar (on a computer) → Settings → pick the calendar on the left →
// "Integrate calendar" → "Secret address in iCal format". Keep it secret: anyone with it can read that calendar.

const DEFAULT_ORIGINS = ["https://acompora19.github.io"];
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",") : DEFAULT_ORIGINS).map(s => s.trim()).filter(Boolean);
    const originOK = !origin || allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      "Access-Control-Allow-Origin": originOK && origin ? origin : allowed[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Key",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!originOK) return new Response("Not allowed from that site", { status: 403, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === "/extract") return extract(request, env, cors);
    if (url.pathname === "/calendar/add") return calendarAdd(request, env, cors);
    if (url.pathname === "/" || url.pathname === "/events") return events(request, env, ctx, cors, url);
    return new Response("Compora Daily Worker. GET /events, POST /extract", { status: 404, headers: cors });
  },
};

async function events(request, env, ctx, cors, url) {
  // five-minute cache so a tablet polling every few minutes doesn't hammer Google
  // (on a free *.workers.dev address this cache is a no-op, which is fine: the page only asks every 5 minutes anyway)
  const cache = caches.default;
  const cacheKey = new Request(url.origin + "/events", { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); r.headers.set("X-Cache", "hit"); return r; }

  const cals = Object.keys(env).filter(k => k.startsWith("CAL_") && typeof env[k] === "string" && env[k].trim())
    .map(k => ({ id: k.slice(4).toLowerCase(), url: env[k].trim() }));
  if (!cals.length) {
    return json({ error: "No calendars yet. Add CAL_TONY, CAL_MOM, CAL_MIA, CAL_FAMILY as secrets in the Worker's settings." }, 200, cors);
  }

  const results = await Promise.all(cals.map(async c => {
    try {
      const r = await fetch(c.url, { headers: { "User-Agent": "compora-daily/1.0" }, cf: { cacheTtl: 0 } });
      if (!r.ok) return { id: c.id, error: `HTTP ${r.status}` };
      const text = await r.text();
      if (!/BEGIN:VCALENDAR/i.test(text)) return { id: c.id, error: "That link didn't return a calendar. Is it the 'Secret address in iCal format'?" };
      return { id: c.id, ics: text };
    } catch (e) {
      return { id: c.id, error: String(e.message || e) };
    }
  }));

  const body = { fetched: new Date().toISOString(), calendars: results.filter(r => r.ics), errors: results.filter(r => r.error) };
  const res = json(body, 200, { ...cors, "Cache-Control": "public, max-age=300" });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// POST /extract  { kind: "email" | "alert", text, today: "YYYY-MM-DD", from?, subject? }
//  → { events: [{ title, date, time, end, location, who, note }] }   (time/end "HH:MM" 24h or null)
//  For kind "alert" (a city notice about trash), also → { trash: { moved_to: "YYYY-MM-DD" | null, note } }
async function extract(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  if (!env.WORKER_KEY || request.headers.get("X-Key") !== env.WORKER_KEY) return json({ error: "bad key" }, 401, cors);
  if (!env.AI) return json({ error: "No AI binding. Worker → Settings → Bindings → Add → Workers AI, variable name AI." }, 500, cors);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, cors); }
  const text = String(body.text || "").slice(0, 6000);
  const today = String(body.today || new Date().toISOString().slice(0, 10));
  const kind = body.kind === "alert" ? "alert" : "email";
  if (!text.trim()) return json({ events: [] }, 200, cors);

  const system = kind === "email"
    ? `You read one email sent to a family in Canal Winchester, Ohio and pull out things that belong on their wall calendar:
appointments, school and daycare events, practices, games, lessons, parties, reservations, deliveries with a definite date, bills or forms with a due date.
Ignore marketing, sales, "offer ends", generic newsletters, surveys, and anything with no definite date. Ignore events already in the past.
Today is ${today}. If the email gives a weekday but no date, use the next such weekday on or after the email's date.
"who" is tony (the dad), mom, mia (the young daughter), or family. Keep titles short, like "Mia's dentist" or "Picture day".
Answer with JSON only.`
    : `You read a notice from a city or trash hauler in Ohio. Today is ${today}. Decide whether it says that trash or recycling pickup is moved to a different day
(because of a holiday or weather). If so, give the new pickup date as YYYY-MM-DD in moved_to; otherwise null. Put a one-line plain-English summary in note.
Answer with JSON only.`;
  const schema = kind === "email"
    ? { type: "object", properties: { events: { type: "array", items: { type: "object", properties: {
          title: { type: "string" }, date: { type: "string" }, time: { type: ["string", "null"] }, end: { type: ["string", "null"] },
          location: { type: "string" }, who: { type: "string" }, note: { type: "string" } }, required: ["title", "date", "time", "end", "location", "who", "note"] } } }, required: ["events"] }
    : { type: "object", properties: { trash: { type: "object", properties: { moved_to: { type: ["string", "null"] }, note: { type: "string" } }, required: ["moved_to", "note"] } }, required: ["trash"] };

  const user = (body.from || body.subject ? `From: ${body.from || ""}\nSubject: ${body.subject || ""}\n\n` : "") + text;
  let out;
  try {
    const r = await env.AI.run(MODEL, {
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: schema },
      max_tokens: 800, temperature: 0.1,
    });
    out = typeof r.response === "string" ? JSON.parse(r.response) : r.response;
  } catch (e) {
    return json({ error: "AI failed: " + String(e.message || e) }, 502, cors);
  }
  // tidy up what came back
  if (kind === "email") {
    const ok = [];
    for (const ev of out?.events || []) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(ev.date || "") ? ev.date : null;
      if (!date || date < today) continue;
      const t = s => (typeof s === "string" && /^\d{1,2}:\d{2}$/.test(s)) ? s.padStart(5, "0") : null;
      ok.push({ title: String(ev.title || "").slice(0, 80) || "Event", date, time: t(ev.time), end: t(ev.end), location: String(ev.location || "").slice(0, 120),
        who: ["tony", "mom", "mia", "family"].includes(ev.who) ? ev.who : "family", note: String(ev.note || "").slice(0, 200) });
    }
    return json({ events: ok.slice(0, 5) }, 200, cors);
  }
  const mv = out?.trash?.moved_to;
  return json({ trash: { moved_to: /^\d{4}-\d{2}-\d{2}$/.test(mv || "") ? mv : null, note: String(out?.trash?.note || "").slice(0, 200) } }, 200, cors);
}

// POST /calendar/add  { title, allDay, date | start, end, location, desc, who, calendar } → whatever the Apps Script answers
async function calendarAdd(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  if (!env.GCAL_HOOK) return json({ error: "No GCAL_HOOK yet. Add the Apps Script web app URL as a secret on the Worker." }, 500, cors);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, cors); }
  try {
    // Apps Script answers through a redirect to script.googleusercontent.com; fetch follows it.
    const r = await fetch(env.GCAL_HOOK, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ ...body, key: env.WORKER_KEY }), redirect: "follow" });
    const text = await r.text();
    let out;
    try { out = JSON.parse(text); } catch { out = { error: "Apps Script answered with something that isn't JSON: " + text.slice(0, 200) }; }
    return json(out, out.error ? 502 : 200, cors);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502, cors);
  }
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}
