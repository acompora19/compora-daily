// Compora Daily calendar Worker (Cloudflare Workers, free tier).
//
// The page can't read Google Calendar's secret iCal links directly (the links would be visible in the code, and
// Google doesn't allow browser requests to them). So this little server holds the links as secrets, fetches
// them, and hands the raw calendar text to the page. Nothing is stored; every call is a fresh read, cached 5 min.
//
// SETTINGS (Worker → Settings → Variables and Secrets), one per calendar, all type "Secret":
//   CAL_TONY    = https://calendar.google.com/calendar/ical/....../private-....../basic.ics
//   CAL_MOM     = ...
//   CAL_MIA     = ...
//   CAL_FAMILY  = ...
// The part after CAL_ (lowercased) is the id the page uses to pick a color: tony, mom, mia, family.
// Add any other CAL_SOMETHING and it shows up in gray.
//
// Optional, type "Text":
//   ALLOWED_ORIGINS = https://acompora19.github.io,http://localhost:8000   (who may call this; default is the GitHub Pages site)
//
// Where to find a secret iCal link: Google Calendar (on a computer) → Settings → pick the calendar on the left →
// "Integrate calendar" → "Secret address in iCal format". Keep it secret: anyone with it can read that calendar.

const DEFAULT_ORIGINS = ["https://acompora19.github.io"];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",") : DEFAULT_ORIGINS).map(s => s.trim()).filter(Boolean);
    const originOK = !origin || allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      "Access-Control-Allow-Origin": originOK && origin ? origin : allowed[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!originOK) return new Response("Not allowed from that site", { status: 403, headers: cors });

    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/events") {
      return new Response("Compora Daily calendar Worker. GET /events", { status: 404, headers: cors });
    }

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
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}
