/* ==========================================================================
   Routes — Public (no-login) surface (/api/public/*)

   The ONLY unauthenticated capability in the system: outlet users can submit a
   new ticket without an account. Everything else stays behind requireAuth/RBAC.

     GET  /api/public/meta            outlets + categories for the form (safe)
     POST /api/public/upload          optional attachment (rate-limited, validated)
     POST /api/public/quick-report    create a New ticket (rate-limited)
     GET  /api/public/track/:number   status lookup, requires the secret token

   Hard limits on the public surface:
     • cannot list tickets, users, reports, or any other data
     • cannot assign, change status, resolve or close
     • status is always 'New', source always 'public_quick_report'
     • requestor_user_id is always NULL
   ========================================================================== */
const express = require("express");
const crypto = require("crypto");
const db = require("../../database");
const { rateLimit } = require("../middleware/auth");
const { DEPARTMENTS, URGENCIES } = require("../config/constants");
const { APP_URL } = require("../config/env");
const { insertWithNumber } = require("../utils/ticketNumber");
const { logActivity } = require("../services/auditLog.service");
const { storeValidated, normalizeIds } = require("../services/upload.service");
const { upload } = require("../config/uploads");
const { notify, alertNewTicket } = require("../../services/notifications");
const { LIMITS, ValidationError, optStr, optPhone } = require("../utils/validate");

const router = express.Router();

// --- GET /api/public/meta --------------------------------------------------
router.get(
  "/api/public/meta",
  rateLimit({ windowMs: 60 * 1000, max: 60 }),
  async (req, res) => {
    try {
      const outlets = await db.pAll(
        "SELECT code, name, brand_code, region FROM outlets WHERE active = 1 ORDER BY brand_code, code",
      );
      const cats = await db.pAll(
        "SELECT department_code, name FROM categories WHERE active = 1 ORDER BY department_code, sort_order, name",
      );
      const categories = { IT: [], ME: [] };
      for (const c of cats)
        if (categories[c.department_code]) categories[c.department_code].push(c.name);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ outlets, categories });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load form data" });
    }
  },
);

// --- POST /api/public/upload -----------------------------------------------
// Stored unlinked (ticket_id NULL, uploaded_by NULL) and linked on submit. The
// hourly cleanup removes anything never linked.
router.post(
  "/api/public/upload",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: "Too many uploads. Please wait a few minutes." }),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const out = await storeValidated(req.file.path, {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedBy: null,
    });
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.status(201).json({ id: out.row.id, file_name: out.row.file_name, file_size: out.row.file_size });
  },
);

// --- POST /api/public/quick-report -----------------------------------------
router.post(
  "/api/public/quick-report",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: "Too many reports from this device. Please wait a few minutes." }),
  async (req, res) => {
    try {
      const b = req.body || {};
      const department = String(b.department || "").toUpperCase();
      if (!DEPARTMENTS.includes(department))
        return res.status(400).json({ error: "Department must be IT or ME" });
      if (!b.outlet_code) return res.status(400).json({ error: "Outlet is required" });
      if (!b.category) return res.status(400).json({ error: "Category is required" });
      const description = optStr(b.description, LIMITS.description, "Description");
      if (!description)
        return res.status(400).json({ error: "A short issue description is required" });
      const reporterName = optStr(b.reporter_name, LIMITS.name, "Reporter name");
      if (!reporterName) return res.status(400).json({ error: "Reporter name is required" });
      const reporterContact = optPhone(b.contact_number || b.reporter_contact, "WhatsApp number");
      if (!reporterContact)
        return res.status(400).json({ error: "Contact / WhatsApp number is required" });
      const locationDetail = optStr(b.location_detail, LIMITS.short, "Location");

      const cat = await db.pGet(
        "SELECT 1 FROM categories WHERE department_code = ? AND name = ? AND active = 1",
        [department, String(b.category)],
      );
      if (!cat)
        return res.status(400).json({ error: `Category is not available for ${department}` });

      const outlet = await db.pGet(
        "SELECT code, brand_code, region FROM outlets WHERE code = ? AND active = 1",
        [String(b.outlet_code)],
      );
      if (!outlet) return res.status(400).json({ error: "Unknown outlet" });

      const urgency = URGENCIES.includes(b.urgency) ? b.urgency : "Medium";
      const title = description.slice(0, 80);

      // Secure tracking token — only its sha256 hash is stored.
      const rawToken = crypto.randomBytes(24).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

      const { number: ticketNumber, result: r } = await insertWithNumber(department, (number) =>
        db.pRun(
          `INSERT INTO tickets
            (ticket_number, title, description, department, category, outlet_code, brand_code, region,
             status, urgency, report_mode, requestor_user_id, customer_name, contact_person, contact_number,
             location_detail, assignee_name, source,
             public_reporter_name, public_reporter_contact, tracking_token_hash, tracking_token_created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New', ?, 'quick', NULL, ?, ?, ?, ?, 'Unassigned', 'public_quick_report',
             ?, ?, ?, datetime('now'))`,
          [
            number, title, description, department, String(b.category), outlet.code,
            outlet.brand_code || null, outlet.region || "Jakarta", urgency,
            reporterName, reporterName, reporterContact, locationDetail,
            reporterName, reporterContact, tokenHash,
          ],
        ),
      );
      const ticketId = r.lastID;

      // Link pre-uploaded PUBLIC attachments (uploaded_by NULL, unlinked).
      const ids = normalizeIds(b.attachmentIds, 5);
      if (ids.length) {
        await db.pRun(
          `UPDATE attachments SET ticket_id = ?
            WHERE id IN (${ids.map(() => "?").join(",")}) AND ticket_id IS NULL AND uploaded_by IS NULL`,
          [ticketId, ...ids],
        );
      }

      await logActivity(
        ticketId,
        null,
        "ticket.created",
        `Ticket created from Public Quick Report • ${ticketNumber} • ${department}/${b.category} • ${outlet.code}`,
      );

      const admins = await db.pAll(
        `SELECT username, email, phone FROM users WHERE is_active = 1 AND role IN ('SuperAdmin', ?)`,
        [department === "IT" ? "AdminIT" : "AdminME"],
      );
      notify("ticket.created", {
        ticketId,
        recipients: admins,
        message: `New public ${department} ticket ${ticketNumber}`,
        channels: ["in_app"],
      });
      const displayTicketNumber = `${ticketNumber} - ${outlet.code}`;
      const publicTrackUrl = `${APP_URL}/track/${encodeURIComponent(ticketNumber)}?token=${rawToken}`;
      notify("ticket.created", {
        ticketId,
        ticketNumber: displayTicketNumber,
        recipients: [{ name: reporterName, phone: reporterContact }],
        message: `Tiket pelaporan anda telah berhasil dibuat!\n\n• *Nomor Tiket*: ${displayTicketNumber}\n👉 ${publicTrackUrl}`,
        channels: ["whatsapp"],
      });
      alertNewTicket({
        ticketId,
        department,
        displayNumber: displayTicketNumber,
        message:
          `🚨 *TIKET BARU (PUBLIC QUICK REPORT)* 🚨\n• *Nomor Tiket*: ${displayTicketNumber}\n👉 ${APP_URL}/tickets/${ticketId}` +
          `\n• *Departemen*: ${department}\n• *Kategori*: ${b.category}\n• *Outlet*: ${outlet.code}` +
          `\n• *Urgensi*: ${urgency}\n• *Pelapor*: ${reporterName} (${reporterContact})` +
          `\n• *Deskripsi*: ${description.slice(0, 500)}`,
      }).catch((e) => console.error("[notify] alert failed:", e.message));

      res.status(201).json({
        ticket_number: ticketNumber,
        status: "New",
        created_at: new Date().toISOString(),
        tracking_token: rawToken,
        track_url: `/track/${encodeURIComponent(ticketNumber)}?token=${rawToken}`,
      });
    } catch (e) {
      if (e instanceof ValidationError) return res.status(400).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: "Failed to create ticket" });
    }
  },
);

// --- GET /api/public/track/:ticket_number?token=... ------------------------
// Public-safe status lookup, gated by the secret token.
router.get(
  "/api/public/track/:ticket_number",
  rateLimit({ windowMs: 60 * 1000, max: 30 }),
  async (req, res) => {
    try {
      const token = String(req.query.token || "");
      if (!/^[a-f0-9]{48}$/i.test(token))
        return res.status(400).json({ error: "A valid tracking token is required" });
      const hash = crypto.createHash("sha256").update(token.toLowerCase()).digest("hex");
      const t = await db.pGet(
        `SELECT id, ticket_number, status, department, category, outlet_code, region,
                created_at, updated_at, assigned_technician_id, scheduled_at, resolved_at, closed_at
           FROM tickets WHERE ticket_number = ? AND tracking_token_hash = ?`,
        [String(req.params.ticket_number).slice(0, 40), hash],
      );
      if (!t)
        return res.status(404).json({ error: "Ticket not found or invalid token" });
      res.setHeader("Cache-Control", "no-store");
      res.json({
        ticket_number: t.ticket_number,
        status: t.status,
        department: t.department,
        category: t.category,
        outlet: t.outlet_code,
        region: t.region,
        technician_assigned: !!t.assigned_technician_id,
        scheduled_at: t.status === "On Scheduled" ? t.scheduled_at : null,
        created_at: t.created_at,
        resolved_at: t.resolved_at || t.closed_at || null,
        last_update_at: t.updated_at || t.created_at,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to track ticket" });
    }
  },
);

module.exports = router;
