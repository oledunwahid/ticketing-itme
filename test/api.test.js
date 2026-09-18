/* End-to-end API tests: `npm test`
   Boots the real app on a random port against a throw-away database and
   uploads folder, then exercises auth, RBAC, uploads and ticket edge cases. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itme-test-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  DB_PATH: path.join(tmp, "test.db"),
  UPLOADS_DIR: path.join(tmp, "uploads"),
  PORT: "0",
  HOST: "127.0.0.1",
  APP_URL: "http://itme.local",
  FONNTE_ENABLED: "false",
  JWT_SECRET: "test-secret-test-secret-test-secret-1234",
});

const app = require("../app");
const db = require("../database");

let server;
let base;
const PW = "Password123!";
// 1x1 PNG
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f1e2d30000000049454e44ae426082",
  "hex",
);

class Client {
  constructor() { this.cookie = ""; }
  async req(method, url, body, headers = {}) {
    const opts = { method, headers: { ...headers }, redirect: "manual" };
    if (this.cookie) opts.headers.cookie = this.cookie;
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) {
      opts.headers["content-type"] = "application/json";
      opts.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(base + url, opts);
    const set = res.headers.getSetCookie();
    for (const c of set) {
      const [pair] = c.split(";");
      if (pair.startsWith("token=")) this.cookie = pair === "token=" ? "" : pair;
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, body: json, text, headers: res.headers };
  }
  get(u, h) { return this.req("GET", u, undefined, h); }
  post(u, b, h) { return this.req("POST", u, b, h); }
  patch(u, b, h) { return this.req("PATCH", u, b, h); }
  del(u, h) { return this.req("DELETE", u, undefined, h); }
}
async function login(email, password = PW) {
  const c = new Client();
  const r = await c.post("/api/auth/login", { email, password });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return c;
}
async function newTicket(c, extra = {}) {
  const r = await c.post("/api/tickets", {
    department: "IT",
    outlet_code: "UPS",
    category: "Printer",
    description: `Printer jam ${Math.random()}`,
    ...extra,
  });
  assert.equal(r.status, 201, r.text);
  return r.body;
}

before(async () => {
  server = await app.start();
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => db.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("health, security headers, same-origin CORS", async () => {
  const c = new Client();
  const r = await c.get("/api/health", { origin: "http://evil.example" });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(r.headers.get("x-powered-by"), null);
  const page = await c.get("/tickets/1");
  assert.equal(page.status, 200);
  assert.match(page.text, /<div id="app-shell"/);
  assert.equal((await c.get("/api/nope")).status, 404);
});

test("login: generic failure, lockout, success sets cookie", async () => {
  const c = new Client();
  assert.equal((await c.post("/api/auth/login", { email: "nobody@x.io", password: "x" })).status, 401);
  assert.equal((await c.post("/api/auth/login", { email: "leader@union.com", password: "wrong" })).status, 401);
  assert.equal((await c.post("/api/auth/login", { email: 5, password: [] })).status, 400);
  for (let i = 0; i < 4; i++) await c.post("/api/auth/login", { email: "leader@union.com", password: "wrong" });
  const locked = await c.post("/api/auth/login", { email: "leader@union.com", password: PW });
  assert.equal(locked.status, 423);
  await db.pRun("UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE email = 'leader@union.com'");
  const ok = await login("leader@union.com");
  const me = await ok.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.role, "Leader");
  assert.equal(me.body.password_hash, undefined);
});

test("malformed / oversized bodies are 400 / 413, not 500", async () => {
  const c = await login("superadmin@union.com");
  assert.equal((await c.post("/api/tickets", "{bad json")).status, 400);
  const big = await c.post("/api/import/users", { csv: "x".repeat(4 * 1024 * 1024) });
  assert.equal(big.status, 413);
});

test("cross-site state change is blocked, same origin allowed", async () => {
  const c = await login("superadmin@union.com");
  const evil = await c.post("/api/tickets", {}, { origin: "http://evil.example" });
  assert.equal(evil.status, 403);
  const same = await c.post("/api/tickets", {}, { origin: base });
  assert.equal(same.status, 400); // reached validation
});

test("chunk upload: path traversal rejected, ordered chunks assemble", async () => {
  const c = await login("requestor@union.com");
  const bad = new FormData();
  for (const [k, v] of Object.entries({ fileId: "../../../app", chunkIndex: 0, totalChunks: 1, fileName: "x.png", mimeType: "image/png", fileSize: PNG.length }))
    bad.append(k, String(v));
  bad.append("chunk", new Blob([PNG]), "x.png");
  const r1 = await c.post("/api/attachments/upload-chunk", bad);
  assert.equal(r1.status, 400);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "app.js")));

  const half = Math.ceil(PNG.length / 2);
  const send = (idx, part) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ fileId: "abc123xyz", chunkIndex: idx, totalChunks: 2, fileName: "../shot.png", mimeType: "image/png", fileSize: PNG.length }))
      fd.append(k, String(v));
    fd.append("chunk", new Blob([part]), "shot.png");
    return c.post("/api/attachments/upload-chunk", fd);
  };
  assert.equal((await send(1, PNG.subarray(half))).status, 409); // out of order
  assert.equal((await send(0, PNG.subarray(0, half))).status, 200);
  const done = await send(1, PNG.subarray(half));
  assert.equal(done.status, 201, done.text);
  assert.match(done.body.id, /^[0-9a-f-]{36}$/);
  assert.equal(done.body.file_name, "shot.png");
  assert.equal((await c.get(`/api/attachments/${done.body.id}`)).status, 200);
});

test("uploads: type spoofing rejected; others cannot take or delete my evidence", async () => {
  const owner = await login("requestor@union.com");
  const other = await login("superadmin@union.com");
  const tech = await login("techit1@union.com");

  const fake = new FormData();
  fake.append("file", new Blob([Buffer.from("<script>alert(1)</script>")], { type: "image/png" }), "x.png");
  assert.equal((await owner.post("/api/attachments/upload", fake)).status, 400);

  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "evidence.png");
  const up = await owner.post("/api/attachments/upload", fd);
  assert.equal(up.status, 201, up.text);
  const attId = up.body.id;

  // Another user tries to attach it to their own ticket: silently ignored.
  const t = await newTicket(other, { attachmentIds: [attId] });
  const detail = await other.get(`/api/tickets/${t.id}`);
  assert.equal(detail.body.attachments.length, 0);
  // A technician cannot delete someone else's draft upload.
  assert.equal((await tech.del(`/api/attachments/${attId}`)).status, 403);
  // Owner links it properly.
  const mine = await newTicket(owner, { attachmentIds: [attId], outlet_code: "UTP" });
  const d2 = await owner.get(`/api/tickets/${mine.id}`);
  assert.equal(d2.body.attachments.length, 1);
  // Once on a ticket, the requestor can no longer delete it (history).
  assert.equal((await owner.del(`/api/attachments/${attId}`)).status, 403);
  assert.equal((await owner.get(`/api/attachments/${attId}`)).status, 200);
  assert.equal((await tech.get(`/api/attachments/${attId}`)).status, 403); // outside tech scope
  assert.equal((await owner.get("/api/attachments/..%2F..%2Fapp.js")).status, 404);
});

test("ticket numbers stay unique under concurrent creates", async () => {
  const c = await login("superadmin@union.com");
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      c.post("/api/tickets", { department: "ME", outlet_code: "UTP", category: "AC", description: `AC ${i}` }),
    ),
  );
  for (const r of results) assert.equal(r.status, 201, r.text);
  const numbers = new Set(results.map((r) => r.body.ticket_number));
  assert.equal(numbers.size, 12);
  assert.equal(results[0].body.tracking_token_hash, undefined);
});

test("ticket create validation and role limits", async () => {
  const sa = await login("superadmin@union.com");
  const leader = await login("leader@union.com");
  const reqr = await login("requestor@union.com");
  const bad = (b) => sa.post("/api/tickets", { department: "IT", outlet_code: "UPS", category: "Printer", description: "x", ...b });
  assert.equal((await bad({ department: "HR" })).status, 400);
  assert.equal((await bad({ category: "AC" })).status, 400);
  assert.equal((await bad({ outlet_code: "NOPE" })).status, 400);
  assert.equal((await bad({ description: "x".repeat(6000) })).status, 400);
  assert.equal((await bad({ contact_number: "call me" })).status, 400);
  assert.equal((await bad({ scheduled_at: "tomorrow" })).status, 400);
  assert.equal((await bad({ scheduled_at: "2026-10-02T10:00", scheduled_end: "2026-10-01T10:00" })).status, 400);
  assert.equal((await leader.post("/api/tickets", { department: "IT", outlet_code: "UPS", category: "Printer", description: "y" })).status, 403);
  // A requestor cannot file under someone else's email.
  const t = await newTicket(reqr, { customer_email: "boss@union.com", outlet_code: "UTP" });
  assert.equal(t.customer_email, "requestor@union.com");
  // Double submit
  const body = { department: "IT", outlet_code: "UTP", category: "Printer", description: "dup check" };
  assert.equal((await reqr.post("/api/tickets", body)).status, 201);
  assert.equal((await reqr.post("/api/tickets", body)).status, 409);
});

test("search treats % and _ literally; list carries SLA fields", async () => {
  const c = await login("superadmin@union.com");
  await newTicket(c, { description: "Discount 100% not applied" });
  const all = await c.get("/api/tickets?search=%25");
  assert.equal(all.status, 200);
  assert.ok(all.body.length >= 1);
  assert.ok(all.body.every((t) => /%/.test(t.title + t.description)));
  assert.ok(["On Track", "Not Started", "At Risk", "Breached", "Met", "N/A"].includes(all.body[0].sla_status));
});

test("status flow: guards, reopen clears finish times and logs the reason", async () => {
  const sa = await login("superadmin@union.com");
  const t = await newTicket(sa);
  const p = (b) => sa.patch(`/api/tickets/${t.id}`, b);
  assert.equal((await p({ status: "Closed", resolution_note: "done" })).status, 400); // must pass On Progress
  assert.equal((await p({ status: "Bogus" })).status, 400);
  assert.equal((await p({ status: "On Progress" })).status, 200);
  assert.equal((await p({ status: "Resolved" })).status, 400); // needs note
  const closed = await p({ status: "Closed", resolution_note: "Replaced roller" });
  assert.equal(closed.status, 200);
  assert.ok(closed.body.closed_at && closed.body.resolved_at);
  assert.equal((await p({ status: "Open" })).status, 400); // reopen needs reason
  const reopened = await p({ status: "Open", reason: "Jammed again" });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.closed_at, null);
  assert.equal(reopened.body.resolved_at, null);
  const d = await sa.get(`/api/tickets/${t.id}`);
  assert.ok(d.body.activity.some((a) => /reopened/.test(a.detail) && /Jammed again/.test(a.detail)));
  assert.equal((await p({ estimated_cost: "abc" })).status, 400);
  assert.equal((await p({ department: "ME" })).status, 400); // category must fit ME
  assert.equal((await p({ department: "ME", category: "AC" })).status, 200);
});

test("technician: all-outlet scope opens detail; self-assign is race-safe", async () => {
  const sa = await login("superadmin@union.com");
  const t = await newTicket(sa, { outlet_code: "IND1" }); // outside everyone's PIC list
  const edi = await login("edi@union.com"); // all_outlets = 1
  assert.equal((await edi.get(`/api/tickets/${t.id}`)).status, 200);
  const t1 = await login("techit1@union.com"); // PIC-scoped, cannot see IND1
  assert.equal((await t1.get(`/api/tickets/${t.id}`)).status, 404);

  const t2 = await newTicket(sa, { outlet_code: "UPS" });
  await db.pRun("UPDATE users SET all_outlets = 1 WHERE email = 'techit2@union.com'");
  const t2c = await login("techit2@union.com");
  const [a, b] = await Promise.all([
    t1.post(`/api/tickets/${t2.id}/assign-to-me`, {}),
    t2c.post(`/api/tickets/${t2.id}/assign-to-me`, {}),
  ]);
  assert.equal(a.status, 200, a.text);
  assert.equal(b.status, 200, b.text);
  const roles = [a.body.self_role, b.body.self_role].sort();
  assert.deepEqual(roles, ["collaborator", "primary"]);
  const team = await sa.get(`/api/tickets/${t2.id}`);
  assert.equal(team.body.activeAssignments.filter((x) => x.role_type === "primary").length, 1);
  assert.equal((await t1.post(`/api/tickets/${t2.id}/assign-to-me`, {})).status, 400);
});

test("sessions: deactivation and password change revoke access immediately", async () => {
  const sa = await login("superadmin@union.com");
  const victim = await login("andi2@union.com").catch(() => null);
  assert.equal(victim, null); // unknown user

  const created = await sa.post("/api/users", { username: "Temp Tech", email: "temp@union.com", password: "Str0ng!Passw0rd", role: "TechnicianIT" });
  assert.equal(created.status, 201, created.text);
  const temp = await login("temp@union.com", "Str0ng!Passw0rd");
  assert.equal((await temp.get("/api/auth/me")).status, 200);
  assert.equal((await sa.patch(`/api/users/${created.body.id}`, { is_active: false })).status, 200);
  assert.equal((await temp.get("/api/auth/me")).status, 401);

  const me = await login("techme2@union.com");
  const stale = new Client();
  stale.cookie = me.cookie;
  assert.equal((await me.post("/api/auth/change-password", { oldPassword: PW, newPassword: "weak", confirmPassword: "weak" })).status, 400);
  const ch = await me.post("/api/auth/change-password", { oldPassword: PW, newPassword: "N3w!Password#", confirmPassword: "N3w!Password#" });
  assert.equal(ch.status, 200, ch.text);
  assert.equal((await me.get("/api/auth/me")).status, 200); // this device re-issued
  assert.equal((await stale.get("/api/auth/me")).status, 401); // other devices out
});

test("user admin guards: self role/deactivate, scope, duplicates", async () => {
  const adminIt = await login("adminit@union.com");
  const meRow = await db.pGet("SELECT id FROM users WHERE email = 'adminit@union.com'");
  // Saving your own profile with your own role works (used to 400).
  assert.equal((await adminIt.patch(`/api/users/${meRow.id}`, { role: "AdminIT", phone: "0812 3456 789" })).status, 200);
  assert.equal((await adminIt.patch(`/api/users/${meRow.id}`, { role: "Leader" })).status, 400);
  assert.equal((await adminIt.patch(`/api/users/${meRow.id}`, { is_active: false })).status, 400);
  assert.equal((await adminIt.patch(`/api/users/${meRow.id}`, { phone: "nope" })).status, 400);
  const sa = await db.pGet("SELECT id FROM users WHERE email = 'superadmin@union.com'");
  assert.equal((await adminIt.patch(`/api/users/${sa.id}`, { is_active: false })).status, 403);
  assert.equal((await adminIt.post("/api/users", { username: "x", email: "x@union.com", password: "Str0ng!Passw0rd", role: "SuperAdmin" })).status, 403);
  const tech = await db.pGet("SELECT id FROM users WHERE email = 'techit1@union.com'");
  assert.equal((await adminIt.patch(`/api/users/${tech.id}`, { email: "techit2@union.com" })).status, 400);
  const list = await adminIt.get("/api/users");
  assert.ok(list.body.every((u) => !["SuperAdmin", "AdminME", "TechnicianME"].includes(u.role)));

  const superC = await login("superadmin@union.com");
  assert.equal((await superC.patch(`/api/users/${sa.id}`, { role: "Leader" })).status, 400);
  assert.equal((await superC.del(`/api/users/${sa.id}`)).status, 400);
});

test("master data: category rename follows tickets; scoped by department", async () => {
  const sa = await login("superadmin@union.com");
  const t = await newTicket(sa, { category: "WiFi" });
  const cats = await sa.get("/api/categories");
  const wifi = cats.body.find((c) => c.department_code === "IT" && c.name === "WiFi");
  const r = await sa.patch(`/api/categories/${wifi.id}`, { name: "Wi-Fi" });
  assert.equal(r.status, 200, r.text);
  assert.equal((await sa.get(`/api/tickets/${t.id}`)).body.ticket.category, "Wi-Fi");
  assert.equal((await sa.patch(`/api/categories/${wifi.id}`, { department_code: "ME" })).status, 409);
  assert.equal((await sa.del(`/api/categories/${wifi.id}`)).status, 409);

  const techMe = await login("techme1@union.com");
  assert.equal((await techMe.patch(`/api/categories/${wifi.id}`, { active: false })).status, 403);
  assert.equal((await techMe.post("/api/categories", { department_code: "IT", name: "Hack" })).status, 403);
  assert.equal((await techMe.post("/api/categories", { department_code: "ME", name: "Generator" })).status, 201);

  const outlets = await sa.get("/api/outlets");
  const ups = outlets.body.find((o) => o.code === "UPS");
  assert.ok(ups.ticket_count >= 1);
  const ren = await sa.patch(`/api/outlets/${ups.id}`, { code: "UPS2" });
  assert.equal(ren.status, 200, ren.text);
  assert.equal((await sa.get(`/api/tickets/${t.id}`)).body.ticket.outlet_code, "UPS2");
  const t1 = await login("techit1@union.com");
  assert.equal((await t1.get(`/api/tickets/${t.id}`)).status, 200); // PIC coverage followed the rename
  await sa.patch(`/api/outlets/${ups.id}`, { code: "UPS" });
  assert.equal((await sa.post("/api/outlets", { brand_code: "UNION", code: "bad code!", name: "X" })).status, 400);
});

test("schedules: validation and overlap", async () => {
  const adminMe = await login("adminme@union.com");
  const tech = await db.pGet("SELECT id FROM users WHERE email = 'techme1@union.com'");
  const itTech = await db.pGet("SELECT id FROM users WHERE email = 'techit1@union.com'");
  const add = (id, b) => adminMe.post(`/api/technicians/${id}/schedules`, b);
  assert.equal((await add(tech.id, { day_of_week: 9, start_time: "09:00", end_time: "10:00" })).status, 400);
  assert.equal((await add(tech.id, { day_of_week: 0, start_time: "10:00", end_time: "09:00" })).status, 400);
  assert.equal((await add(tech.id, { day_of_week: 0, start_time: "9am", end_time: "10:00" })).status, 400);
  assert.equal((await add(tech.id, { day_of_week: 0, start_time: "08:00", end_time: "12:00" })).status, 201);
  assert.equal((await add(tech.id, { day_of_week: 0, start_time: "11:00", end_time: "13:00" })).status, 409);
  assert.equal((await add(itTech.id, { day_of_week: 0, start_time: "08:00", end_time: "12:00" })).status, 403);
  const bulk = await adminMe.get("/api/technicians?department=ME&include=schedules");
  assert.equal(bulk.status, 200);
  assert.ok(Array.isArray(bulk.body[0].schedules));
  assert.equal((await adminMe.post(`/api/technicians/${tech.id}/unavailability`, { start_datetime: "2026-10-02T10:00", end_datetime: "2026-10-01T10:00" })).status, 400);
});

test("dashboard, reports and exports", async () => {
  const sa = await login("superadmin@union.com");
  const d = await sa.get("/api/dashboard");
  assert.equal(d.status, 200, d.text);
  for (const k of ["totals", "sla", "trend", "aging", "byStatus", "workload"]) assert.ok(k in d.body, k);
  assert.equal(d.body.trend.length, 14);
  assert.ok(d.body.totals.created_today >= 1);
  const tech = await login("edi@union.com");
  const td = await tech.get("/api/dashboard");
  assert.ok(td.body.mine && typeof td.body.mine.open === "number");

  assert.equal((await sa.get("/api/reports/performance?start_date=yesterday")).status, 400);
  assert.equal((await sa.get("/api/reports/performance?start_date=2026-02-01&end_date=2026-01-01")).status, 400);
  const perf = await sa.get("/api/reports/performance");
  assert.equal(perf.status, 200);
  const csv = await sa.get("/api/tickets/export");
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.equal((await tech.get("/api/reports/performance")).status, 403);
});

test("analytics: filters, scope, xlsx and csv exports", async () => {
  const sa = await login("superadmin@union.com");
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const a = await sa.get("/api/analytics");
  assert.equal(a.status, 200, a.text);
  assert.equal(a.body.granularity, "day");
  assert.equal(a.body.trend.length, 30);
  assert.ok(a.body.kpis.created >= 10);
  const sumTrend = a.body.trend.reduce((x, t) => x + t.created, 0);
  assert.equal(sumTrend, a.body.kpis.created);
  assert.equal(a.body.stages.reduce((x, t) => x + t.value, 0), a.body.kpis.created);
  assert.equal(a.body.heatmap.values.flat().reduce((x, y) => x + y, 0), a.body.kpis.created);
  for (const k of ["categories", "outlets", "technicians", "sla_by_urgency", "resolution_distribution", "aging", "options", "detail"]) assert.ok(k in a.body, k);

  const me = await sa.get("/api/analytics?department=ME");
  assert.ok(me.body.detail.every((t) => t.department === "ME"));
  assert.ok(me.body.kpis.created < a.body.kpis.created);
  assert.ok(me.body.options.departments.includes("IT")); // options ignore the dimension filters

  const yr = await sa.get(`/api/analytics?from=${today.getFullYear() - 1}-01-01&to=${iso(today)}`);
  assert.equal(yr.body.granularity, "month");
  assert.equal((await sa.get("/api/analytics?from=2026-02-01&to=2026-01-01")).status, 400);
  assert.equal((await sa.get("/api/analytics?from=2020-01-01&to=2026-01-01")).status, 400);
  assert.equal((await sa.get("/api/analytics?from=nope")).status, 400);

  const xlsx = await fetch(base + "/api/analytics/export?format=xlsx", { headers: { cookie: sa.cookie } });
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get("content-type"), /spreadsheetml/);
  const buf = Buffer.from(await xlsx.arrayBuffer());
  assert.equal(buf.readUInt32LE(0), 0x04034b50); // ZIP
  const names = [];
  for (let i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); i >= 0; i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i + 4)) {
    const len = buf.readUInt16LE(i + 28);
    names.push(buf.slice(i + 46, i + 46 + len).toString());
  }
  assert.ok(names.includes("xl/workbook.xml"));
  assert.ok(names.filter((n) => n.startsWith("xl/worksheets/")).length >= 10);

  const csv = await sa.get("/api/analytics/export?format=csv&department=IT");
  assert.equal(csv.status, 200);
  const lines = csv.text.trim().split(/\r?\n/);
  assert.match(lines[0], /Ticket,Subject,Status/);
  assert.ok(lines.length - 1 >= 1);
  assert.match(lines[0], /SLA status/);
  // SLA is IT-side only: a requestor's export leaves it out.
  const rcsv = await (await login("requestor@union.com")).get("/api/analytics/export?format=csv");
  assert.equal(rcsv.status, 200);
  assert.doesNotMatch(rcsv.text.split(/\r?\n/)[0], /SLA/);

  // Scope still applies: a requestor only ever sees their own tickets.
  const reqr = await login("requestor@union.com");
  const ra = await reqr.get("/api/analytics");
  assert.equal(ra.status, 200);
  const own = await db.pGet("SELECT id FROM users WHERE email = 'requestor@union.com'");
  const ids = ra.body.detail.map((t) => t.id);
  if (ids.length) {
    const rows = await db.pAll(`SELECT requestor_user_id, customer_email FROM tickets WHERE id IN (${ids.join(",")})`);
    assert.ok(rows.every((r) => r.requestor_user_id === own.id || r.customer_email === "requestor@union.com"));
  }
  const tech = await login("techit1@union.com");
  const ta = await tech.get("/api/analytics");
  assert.ok(ta.body.mine && typeof ta.body.mine.open === "number");
  assert.ok(ta.body.detail.every((t) => t.department === "IT"));
});

test("public quick report is disabled; everything requires login", async () => {
  const c = new Client();
  assert.equal((await c.get("/api/public/meta")).status, 404);
  assert.equal((await c.post("/api/public/quick-report", {})).status, 404);
  assert.equal((await c.get("/api/tickets")).status, 401);
});

test("master data workbook: template, preview, all-or-nothing import, export", async () => {
  const { buildXlsx } = require("../src/utils/xlsx");
  const { readXlsx } = require("../src/utils/xlsxRead");
  const sa = await login("superadmin@union.com");

  // Template: README + one empty sheet per module, headers in row 1.
  const tpl = await fetch(base + "/api/export/template", { headers: { cookie: sa.cookie } });
  assert.equal(tpl.status, 200);
  const sheets = readXlsx(Buffer.from(await tpl.arrayBuffer()));
  assert.deepEqual(sheets.map((s) => s.name), ["README", "Brands", "Locations", "Categories", "Users", "Schedules", "User outlets"]);
  const usersSheet = sheets.find((s) => s.name === "Users");
  assert.deepEqual(usersSheet.rows.length, 1);
  assert.ok(usersSheet.rows[0].cells.includes("initial_password"));

  const sheet = (name, headers, rows) => ({ name, columns: headers.map((h) => ({ header: h, key: h })), rows });
  const book = (extraUserRows = []) => buildXlsx([
    sheet("Brands", ["code", "name"], [{ code: "ACME", name: "Acme Corp" }]),
    sheet("Locations", ["code", "name", "brand_code", "region"], [{ code: "AC1", name: "Acme One", brand_code: "acme", region: "surabaya" }]),
    sheet("Categories", ["department", "name", "sort_order"], [{ department: "IT", name: "Kiosk", sort_order: 5 }]),
    sheet("Users", ["email", "username", "role", "phone", "all_outlets", "initial_password"], [
      { email: "new.tech@acme.test", username: "New Tech", role: "TechnicianIT", phone: "081234567890", all_outlets: 0, initial_password: "Welcome#2026x" },
      { email: "store@acme.test", username: "Acme Store", role: "Requestor", initial_password: "Welcome#2026x" },
      ...extraUserRows,
    ]),
    sheet("Schedules", ["technician_email", "day", "start_time", "end_time"], [
      { technician_email: "new.tech@acme.test", day: "Mon", start_time: "09:00", end_time: "18:00" },
      { technician_email: "new.tech@acme.test", day: "Tue", start_time: "0.375", end_time: "0.75" }, // Excel time fractions
    ]),
    sheet("User outlets", ["user_email", "outlet_code"], [
      { user_email: "new.tech@acme.test", outlet_code: "AC1" },
      { user_email: "store@acme.test", outlet_code: "AC1" },
    ]),
  ]);
  const send = (buf, dryRun) => sa.post("/api/import/workbook", { file: buf.toString("base64"), dryRun });

  // One bad row anywhere rejects the whole workbook, with the Excel row number.
  const bad = book([{ email: "weak@acme.test", username: "Weak", role: "Requestor", initial_password: "short" }]);
  const pre = await send(bad, true);
  assert.equal(pre.status, 200, pre.text);
  const users = pre.body.modules.find((m) => m.key === "users");
  assert.equal(users.errors.length, 1);
  assert.equal(users.errors[0].row, 4);
  assert.equal((await send(bad, false)).status, 400);
  assert.equal((await sa.get("/api/outlets")).body.some((o) => o.code === "AC1"), false);

  // Valid workbook: preview, then apply. Later sheets can use rows from earlier ones.
  const good = book();
  const dry = await send(good, true);
  assert.equal(dry.body.summary.invalid, 0, JSON.stringify(dry.body.modules.map((m) => m.errors)));
  assert.equal(dry.body.summary.toInsert, 9);
  const applied = await send(good, false);
  assert.equal(applied.status, 200, applied.text);
  assert.equal(applied.body.summary.applied, 9);

  const tech = await login("new.tech@acme.test", "Welcome#2026x");
  assert.equal((await tech.get("/api/auth/me")).body.role, "TechnicianIT");
  const sched = await db.pAll(
    "SELECT day_of_week, start_time, end_time FROM technician_schedules s JOIN users u ON u.id = s.user_id WHERE u.email = ? ORDER BY day_of_week",
    ["new.tech@acme.test"],
  );
  assert.deepEqual(sched.map((s) => `${s.day_of_week} ${s.start_time}-${s.end_time}`), ["1 09:00-18:00", "2 09:00-18:00"]);
  const outlet = await db.pGet("SELECT brand_code, region FROM outlets WHERE code = 'AC1'");
  assert.deepEqual({ ...outlet }, { brand_code: "ACME", region: "Surabaya" });

  // Re-importing the same file only updates (nothing duplicated).
  const again = await send(good, true);
  assert.equal(again.body.summary.toInsert, 0);

  // Full export round-trips through the reader; passwords are never exported.
  const exp = await fetch(base + "/api/export/workbook", { headers: { cookie: sa.cookie } });
  const out = readXlsx(Buffer.from(await exp.arrayBuffer()));
  const outUsers = out.find((s) => s.name === "Users").rows;
  const pwCol = outUsers[0].cells.indexOf("initial_password");
  assert.ok(outUsers.some((r) => r.cells.includes("new.tech@acme.test")));
  assert.ok(outUsers.slice(1).every((r) => !r.cells[pwCol]));

  // Imports stay SuperAdmin-only.
  const admin = await login("adminit@union.com");
  assert.equal((await admin.post("/api/import/workbook", { file: good.toString("base64"), dryRun: true })).status, 403);
});
