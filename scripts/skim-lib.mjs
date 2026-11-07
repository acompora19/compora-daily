// skim-lib.mjs: the pieces of the email/town skimmer that don't touch the network, so they can be tested.
import { createHash } from "node:crypto";

// Columbus local date "YYYY-MM-DD" for a Date (GitHub's servers run in UTC).
export function localDate(d = new Date(), tz = "America/New_York") {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = t => p.find(x => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

// A short stable id for an email, from its Message-ID (or subject+date when there isn't one).
export function mailId(messageId, fallback = "") {
  return "m-" + createHash("sha1").update(String(messageId || fallback)).digest("hex").slice(0, 16);
}

// Turn an email's HTML into plain text, roughly.
export function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n\n+/g, "\n").trim();
}

// Clean the body down to what the AI needs: drop link soup, unsubscribe footers, and cap the length.
export function tidyBody(text, max = 3500) {
  let t = String(text || "")
    .replace(/https?:\/\/\S+/g, "")                       // links are noise for finding dates
    .replace(/^.*(unsubscribe|manage (your )?preferences|view (this )?(email )?in (your )?browser|privacy policy).*$/gim, "")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return t.length > max ? t.slice(0, max) + " …" : t;
}

// Cheap first pass: is there anything date-like in here at all? Saves AI calls on "thanks for your order" mail.
const DATEISH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b[\s.,]*\d{1,2}|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)day\b|\btomorrow\b|\b(next|this) (week|mon|tue|wed|thu|fri|sat|sun)/i;
export function looksDated(text) { return DATEISH.test(String(text || "")); }

// Senders we never bother the AI with. Add to it freely.
const SKIP_FROM = /no-?reply@(github|slack|discord|steampowered|twitch|epicgames|spotify|netflix|linkedin|facebookmail|twitter|x\.com)|newsletter|digest|promotions?@|deals?@|offers?@|marketing@|noreply@google\.com/i;
export function skipSender(from) { return SKIP_FROM.test(String(from || "")); }

// Trash-related city notices: titles/descriptions worth sending to the AI.
export function isTrashNotice(text) { return /\b(trash|refuse|garbage|recycl|rumpke|yard waste|collection (day|schedule))/i.test(String(text || "")); }

// Minimal RSS reader (CivicPlus feeds are plain RSS 2.0).
export function parseRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi; let m;
  const pick = (s, tag) => { const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(s); return r ? r[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : ""; };
  while ((m = re.exec(xml))) {
    const s = m[1];
    items.push({ title: htmlToText(pick(s, "title")), link: pick(s, "link"), date: pick(s, "pubDate"), desc: htmlToText(pick(s, "description")) });
  }
  return items;
}

// ---- Firestore REST encoding (no SDK needed in the Action) ----
export function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
}
export function fromFs(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFs);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  return null;
}

// Merge new finds into the inbox doc: skip emails already seen, cap sizes, keep newest first.
export function mergeInbox(doc, newItems, newSeen, now = Date.now()) {
  const items = Array.isArray(doc?.items) ? doc.items : [];
  const seen = Array.isArray(doc?.seen) ? doc.seen : [];
  const seenSet = new Set(seen);
  const fresh = newItems.filter(it => !seenSet.has(it.mail) && !items.some(x => x.id === it.id));
  const merged = [...fresh, ...items].filter(it => !it.date || it.date >= localDate(new Date(now - 86400000))).slice(0, 60);
  const allSeen = [...new Set([...newSeen, ...seen])].slice(0, 800);
  return { items: merged, seen: allSeen, added: fresh.length };
}
