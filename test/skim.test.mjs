// Run with: TZ=America/New_York node test/skim.test.mjs
import * as L from "../scripts/skim-lib.mjs";
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`);

eq(L.localDate(new Date("2026-11-07T03:30:00Z")), "2026-11-06", "UTC 3:30 AM is still the 6th in Columbus");
ok(L.mailId("<abc@mail.gmail.com>").startsWith("m-") && L.mailId("<abc@mail.gmail.com>") === L.mailId("<abc@mail.gmail.com>"), "mail ids are stable");
eq(L.htmlToText("<p>Hi <b>there</b></p><br><div>Picture day is <a href='x'>Nov&nbsp;20</a></div>"), "Hi there\nPicture day is Nov 20", "html to text");
ok(L.looksDated("Picture day is Thursday"), "weekday counts as dated");
ok(L.looksDated("Due 11/20"), "slash date counts");
ok(!L.looksDated("Thanks for your order! Your receipt is attached."), "receipt with no date is skipped");
ok(L.skipSender("GitHub <noreply@github.com>"), "github mail skipped");
ok(!L.skipSender("Canal Winchester Schools <info@cwschools.net>"), "school mail kept");
ok(L.isTrashNotice("Rumpke Holiday Schedule - Collection Scheduled for Friday in CW"), "rumpke alert is a trash notice");
ok(!L.isTrashNotice("New Traffic Signal at Diley Rd"), "traffic alert is not");
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Alerts</title>
<item><title>Rumpke Holiday Schedule</title><link>https://www.canalwinchesterohio.gov/AlertCenter.aspx?AID=617</link><pubDate>Mon, 23 Nov 2026 09:00:00 -0500</pubDate><description><![CDATA[<p>Collection moved to <b>Friday</b>.</p>]]></description></item>
<item><title>Job Posting</title><link>https://x/AID=792</link><pubDate>Tue, 03 Nov 2026 11:17:33 -0500</pubDate><description>Hiring</description></item>
</channel></rss>`;
const items = L.parseRss(rss);
eq(items.length, 2, "two rss items");
eq(items[0].desc, "Collection moved to Friday .", "cdata html description to text");
const fs = L.toFs({ a: 1, b: 2.5, c: "x", d: true, e: null, f: [1, "y"], g: { h: "i" } });
eq(L.fromFs(fs), { a: 1, b: 2.5, c: "x", d: true, e: null, f: [1, "y"], g: { h: "i" } }, "firestore encode/decode round trip");
const doc = { items: [{ id: "old", mail: "m-1", date: "2026-12-01" }, { id: "stale", mail: "m-0", date: "2026-10-01" }], seen: ["m-1", "m-0"] };
const m = L.mergeInbox(doc, [{ id: "new", mail: "m-2", date: "2026-11-20" }, { id: "dup", mail: "m-1", date: "2026-11-21" }], ["m-2", "m-1", "m-3"], new Date("2026-11-07T12:00:00Z").getTime());
eq(m.items.map(i => i.id), ["new", "old"], "new item added, seen email not re-added, stale item dropped");
eq(m.seen, ["m-2", "m-1", "m-3", "m-0"], "seen list merged");
eq(m.added, 1, "one added");
console.log(fails ? `\n${fails} FAILED` : "\nall good"); process.exit(fails ? 1 : 0);
