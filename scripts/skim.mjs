// skim.mjs: runs on GitHub's servers twice a day (see .github/workflows/skim.yml).
//
//  1. Reads recent mail in each Gmail inbox (IMAP, app password), skips the obvious junk, and asks the Worker's AI
//     whether each remaining email holds a dated family event. Finds go to Firestore `daily_inbox/main` as PENDING
//     items; the board shows them in a "Found in email" tray to accept or dismiss. Nothing goes on the calendar by itself.
//  (Trash days don't come from here: the board reads the City of Columbus's own schedule for the address directly.)
//
// Secrets it needs (repo → Settings → Secrets and variables → Actions):
//   GMAIL_1 = "you@gmail.com:abcd efgh ijkl mnop"   (address, colon, the 16-character App Password)
//   GMAIL_2 = the same for the second inbox (optional; GMAIL_3 too)
//   WORKER_URL = only if the Worker moves; it defaults to https://compora-daily.acompora19.workers.dev
//   WORKER_KEY = the same long random string you put on the Worker
//   FIREBASE_KEY = the Firebase web API key (the apiKey in index.html; it's not secret, but keeping it here keeps the script tidy)
//
// Runs fine by hand too:  GMAIL_1=... WORKER_URL=... WORKER_KEY=... node scripts/skim.mjs

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { localDate, mailId, htmlToText, tidyBody, looksDated, skipSender, toFs, fromFs, mergeInbox } from "./skim-lib.mjs";

const PROJECT = process.env.FIREBASE_PROJECT || "mangia-mangia-29ece";
const KEY = process.env.FIREBASE_KEY || "AIzaSyDaBcD1gNsi56k4_w2NV8eWevv5EltjwOk";
const WORKER = (process.env.WORKER_URL || "https://compora-daily.acompora19.workers.dev").replace(/\/+$/, "");
const WKEY = process.env.WORKER_KEY || "";
const DAYS = Number(process.env.SKIM_DAYS || 3);        // how far back to look each run (seen-list stops repeats)
const MAX_PER_BOX = Number(process.env.SKIM_MAX || 40); // newest N per inbox per run
const today = localDate();
const log = (...a) => console.log(...a);

if (!WKEY) { console.error("WORKER_KEY secret is missing (repo → Settings → Secrets and variables → Actions)"); process.exit(1); }

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

const doc = await readDoc("daily_inbox", "main");
const merged = mergeInbox(doc, found, seen);
await patchDoc("daily_inbox", "main", { items: merged.items, seen: merged.seen, ran: Date.now(), today });
log(`   saved: ${merged.added} new pending item(s), ${merged.items.length} in the tray`);
