// Bucket Fillers - self-hosted server. No dependencies, just Node.
// Run with:  node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC = path.join(__dirname, "public");
const PALETTE = ["#E8654F", "#2A9D8F", "#E9A23B", "#6C5CE7"];

let db = { members: [], entries: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) {}

function save() {
  fs.writeFileSync(DATA_FILE + ".tmp", JSON.stringify(db, null, 2));
  fs.renameSync(DATA_FILE + ".tmp", DATA_FILE); // atomic, never corrupts
}
function slugify(s, i) { return (s.toLowerCase().replace(/[^a-z0-9]/g, "") || "friend") + i; }
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
      db.members = names.map((n, i) => ({ name: n, slug: slugify(n, i), color: PALETTE[i % PALETTE.length] }));
      db.members.forEach((m) => { if (!db.entries[m.slug]) db.entries[m.slug] = {}; });
      save();
    }
    return send(res, 200, db);
  }

  if (url === "/api/log" && req.method === "POST") {
    const body = await readBody(req);
    const { slug, date, score, note } = body;
    if (db.entries[slug] !== undefined && date) {
      db.entries[slug][date] = { score: Number(score), note: String(note || "").slice(0, 140) };
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
