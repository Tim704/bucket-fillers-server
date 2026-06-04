// Bucket Fillers - self-hosted server. No dependencies, just Node.
// Run with:  node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC = path.join(__dirname, "public");
const PALETTE = ["#E8654F", "#2A9D8F", "#E9A23B", "#6C5CE7"];

let db = { members: [], entries: {}, incidents: [] };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) {}
// Be tolerant of older data files that predate some fields.
if (!Array.isArray(db.members)) db.members = [];
if (!db.entries || typeof db.entries !== "object") db.entries = {};
if (!Array.isArray(db.incidents)) db.incidents = [];

function save() {
  fs.writeFileSync(DATA_FILE + ".tmp", JSON.stringify(db, null, 2));
  fs.renameSync(DATA_FILE + ".tmp", DATA_FILE); // atomic, never corrupts
}
function slugify(s, i) { return (s.toLowerCase().replace(/[^a-z0-9]/g, "") || "friend") + i; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function clip(s, n) { return String(s == null ? "" : s).slice(0, n); }
function tone(t) { return t === "negative" || t === "down" ? "negative" : "positive"; }
function member(slug) { return db.members.find((m) => m.slug === slug); }
function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch (e) { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/api/data" && req.method === "GET") return send(res, 200, db);

  if (url === "/api/setup" && req.method === "POST") {
    const body = await readBody(req);
    if (!db.members.length) {
      const names = (body.names || []).map((n) => String(n).trim()).filter(Boolean);
      db.members = names.map((n, i) => ({ name: n, slug: slugify(n, i), color: PALETTE[i % PALETTE.length], tz: null }));
      db.members.forEach((m) => { if (!db.entries[m.slug]) db.entries[m.slug] = {}; });
      save();
    }
    return send(res, 200, db);
  }

  // Set / change where a person currently is. Travels with them across timezones.
  if (url === "/api/member" && req.method === "POST") {
    const body = await readBody(req);
    const m = member(body.slug);
    if (m && typeof body.tz === "string") { m.tz = clip(body.tz, 64); save(); }
    return send(res, 200, db);
  }

  if (url === "/api/log" && req.method === "POST") {
    const body = await readBody(req);
    const { slug, date, score, note, ts, tz } = body;
    if (db.entries[slug] !== undefined && date) {
      db.entries[slug][date] = {
        score: Number(score),
        note: clip(note, 140),
        ts: Number(ts) || Date.now(),   // the actual instant it was logged
        tz: clip(tz, 64),               // the timezone the logger was in
      };
      save();
    }
    return send(res, 200, db);
  }

  // Report a positive or negative moment, stamped to the instant it happened.
  if (url === "/api/incident" && req.method === "POST") {
    const body = await readBody(req);
    const m = member(body.slug);
    const title = clip(body.title, 160).trim();
    if (m && title) {
      db.incidents.push({
        id: uid(),
        slug: m.slug,
        tone: tone(body.tone),
        title,
        ts: Number(body.ts) || Date.now(),
        responses: [],
      });
      db.incidents = db.incidents.slice(-200); // keep the feed bounded
      save();
    }
    return send(res, 200, db);
  }

  // Respond with what was happening to you around that same instant.
  if (url === "/api/respond" && req.method === "POST") {
    const body = await readBody(req);
    const inc = db.incidents.find((x) => x.id === body.id);
    const m = member(body.slug);
    const what = clip(body.what, 160).trim();
    if (inc && m && what) {
      if (!Array.isArray(inc.responses)) inc.responses = [];
      const r = { slug: m.slug, tone: tone(body.tone), what, at: Date.now() };
      const i = inc.responses.findIndex((x) => x.slug === m.slug);
      if (i >= 0) inc.responses[i] = r; else inc.responses.push(r); // one response per person
      save();
    }
    return send(res, 200, db);
  }

  // static files
  let file = url === "/" ? "/index.html" : url;
  const fp = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, ""));
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(fp);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => console.log("Bucket Fillers running on port " + PORT));
