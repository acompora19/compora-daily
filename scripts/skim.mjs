// skim.mjs: runs on GitHub's servers twice a day (see .github/workflows/skim.yml).
//
//  1. Reads recent mail in each Gmail inbox (IMAP, app password), skips the obvious junk, and asks the Worker's AI
//     whether each remaining email holds a dated family event. Finds go to Firestore `daily_inbox/main` as PENDING
//     items; the board shows them in a "Found in email" tray to accept or dismiss. Nothing goes on the calendar by itself.
//  2. Reads the City of Canal Winchester's alert and news feeds for trash/Rumpke notices; if one says pickup moved,
//     the board gets a notice and that week's trash day follows it.
//
// Secrets it needs (repo → Settings → Secrets and variables → Actions):
//   GMAIL_1 = "you@gmail.com:abcd efgh ijkl mnop"   (address, colon, the 16-character App Password)
//   GMAIL_2 = the same for the second inbox (optional; GMAIL_3 too)
//   WORKER_URL = https://compora-daily.YOURNAME.workers.dev
//   WORKER_KEY = the same long random string you put on the Worker
//   FIREBASE_KEY = the Firebase web API key (the apiKey in index.html; it's not secret, but keeping it here keeps the script tidy)
//
// Runs fine by hand too:  GMAIL_1=... WORKER_URL=... WORKER_KEY=... node scripts/skim.mjs

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { localDate, mailId, htmlToText, tidyBody, looksDated, skipSender, isTrashNotice, parseRss, toFs, fromFs, mergeInbox } from "./skim-lib.mjs";

const PROJECT = process.env.FIREBASE_PROJECT || "mangia-mangia-29ece";
const KEY = process.env.FIREBASE_KEY || "AIzaSyDaBcD1gNsi56k4_w2NV8eWevv5EltjwOk";
const WORKER = (process.env.WORKER_URL || "").replace(/\/+$/, "");
const WKEY = process.env.WORKER_KEY || "";
const DAYS = Number(process.env.SKIM_DAYS || 3);        // how far back to look each run (seen-list stops repeats)
const MAX_PER_BOX = Number(process.env.SKIM_MAX || 40); // newest N per inbox per run
const TOWN_FEEDS = [
  "https://www.canalwinchesterohio.gov/RSSFeed.aspx?ModID=63&CID=All-alertcenter.xml",
  "https://www.canalwinchesterohio.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml",
];
const today = localDate();
const log = (...a) => console.log(...a);

if (!WORKER || !WKEY) { console.error("WORKER_URL and WORKER_KEY are required"); process.exit(1); }

// ---------- Firestore (REST, no SDK) ----------
const docUrl = (col, id) => `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${col}/${id}?key=${KEY}`;
async function readDoc(col, id) {
  const r = await fetch(docUrl(col, id));
  if (r.status === 404) return {};
  if (!r.ok) throw new Error(`Firestore read ${r.status}: ${await r.text()}`);
  return fromFs({ mapValue: { fields: (await r.json()).fields || {} } }) || {};
}
async function patchDoc(col, id, fields) {
  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const r = await fetch(docUrl(col, id) + "&" + mask, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toFs(v)])) }) });
  if (!r.ok) throw new Error(`Firestore write ${r.status}: ${await r.text()}`);
}

// ---------- the Worker's AI ----------
async function ask(kind, payload) {
  const r = await fetch(WORKER + "/extract", { method: "POST", headers: { "Content-Type": "application/json", "X-Key": WKEY }, body: JSON.stringify({ kind, today, ...payload }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Worker ${r.status}`);
  return j;
}

// ---------- 1. email ----------
async function skimInbox(label, user, pass) {
  const out = { items: [], seen: [], looked: 0, asked: 0, errors: 0 };
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    // Gmail's own search: recent, not promotions/social/forums
    let uids = await client.search({ gmraw: `newer_than:${DAYS}d -category:promotions -category:social -category:forums` }, { uid: true });
    uids = (uids || []).sort((a, b) => b - a).slice(0, MAX_PER_BOX);
    for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
      out.looked++;
      const env = msg.envelope || {};
      const from = (env.from || []).map(a => `${a.name || ""} <${a.address || ""}>`).join(", ");
      const subject = env.subject || "(no subject)";
      const id = mailId(env.messageId, `${subject}|${env.date}`);
      out.seen.push(id);
      if (skipSender(from)) continue;
      let parsed;
      try { parsed = await simpleParser(msg.source); } catch { continue; }
      const body = tidyBody(parsed.text || htmlToText(parsed.html || parsed.textAsHtml || ""));
      if (!looksDated(subject + "\n" + body)) continue;
      out.asked++;
      try {
        const res = await ask("email", { text: body, from, subject });
        for (const ev of res.events || []) {
          out.items.push({ id: `${id}-${ev.date}-${ev.title}`.replace(/[^\w-]+/g, "_").slice(0, 80), mail: id, title: ev.title, date: ev.date, time: ev.time, end: ev.end,
            location: ev.location, who: ev.who, note: ev.note, from: (env.from?.[0]?.name || env.from?.[0]?.address || "").slice(0, 60), subject: subject.slice(0, 100),
            account: label, found: Date.now(), status: "pending" });
        }
      } catch (e) { out.errors++; log(`   ! ${label}: ${subject.slice(0, 50)} → ${e.message}`); }
    }
  } finally { lock.release(); await client.logout().catch(() => {}); }
  return out;
}

// ---------- 2. town notices ----------
async function skimTown() {
  const notices = [];
  for (const feed of TOWN_FEEDS) {
    let xml;
    try { const r = await fetch(feed, { headers: { "User-Agent": "compora-daily/1.0" } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); xml = await r.text(); }
    catch (e) { log(`   ! ${feed}: ${e.message}`); continue; }
    for (const it of parseRss(xml)) {
      const age = (Date.now() - new Date(it.date).getTime()) / 86400000;
      if (!(age <= 14) || !isTrashNotice(it.title + " " + it.desc)) continue;
      const n = { id: "n-" + (it.link.match(/AID=([\w-]+)/)?.[1] || it.title).replace(/[^\w-]+/g, "_").slice(0, 60), title: it.title, link: it.link, posted: new Date(it.date).getTime() || Date.now(), movedTo: null, note: "" };
      try { const res = await ask("alert", { text: `${it.title}\n${it.desc}` }); n.movedTo = res.trash?.moved_to || null; n.note = res.trash?.note || ""; }
      catch (e) { log(`   ! alert AI: ${e.message}`); }
      notices.push(n);
    }
  }
  return notices;
}

// ---------- go ----------
const boxes = ["GMAIL_1", "GMAIL_2", "GMAIL_3"].map(k => process.env[k]).filter(Boolean).map((s, i) => {
  const [user, ...rest] = s.split(":"); return { label: user.trim(), user: user.trim(), pass: rest.join(":").replace(/\s+/g, "") };
});
log(`Compora Daily skim · ${today} · ${boxes.length} inbox(es)`);
const found = [], seen = [];
for (const b of boxes) {
  try {
    const r = await skimInbox(b.label, b.user, b.pass);
    log(`   ${b.label}: looked at ${r.looked}, asked AI about ${r.asked}, found ${r.items.length} event(s), ${r.errors} error(s)`);
    found.push(...r.items); seen.push(...r.seen);
  } catch (e) { log(`   ! ${b.label}: ${e.message}`); }
}
const notices = await skimTown();
log(`   town: ${notices.length} trash notice(s)${notices.map(n => ` · "${n.title}"${n.movedTo ? ` → pickup ${n.movedTo}` : ""}`).join("")}`);

const doc = await readDoc("daily_inbox", "main");
const merged = mergeInbox(doc, found, seen);
await patchDoc("daily_inbox", "main", { items: merged.items, seen: merged.seen, notices, ran: Date.now(), today });
log(`   saved: ${merged.added} new pending item(s), ${merged.items.length} in the tray, ${notices.length} notice(s)`);
