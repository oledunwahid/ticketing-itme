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
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../../database");
const { rateLimit } = require("../middleware/auth");
const { DEPARTMENTS, URGENCIES } = require("../config/constants");
const { nextTicketNumber } = require("../utils/ticketNumber");
const { logActivity } = require("../services/auditLog.service");
const { validateFile } = require("../services/upload.service");
const { UPLOADS_DIR, upload } = require("../config/uploads");
const { notify } = require("../../services/notifications");

const router = express.Router();

// --- GET /api/public/meta --------------------------------------------------
// Minimal reference data the public form needs. Active outlets + categories
// only; nothing sensitive.
router.get(
  "/api/public/meta",
  rateLimit({ windowMs: 60 * 1000, max: 60 }),
  async (req, res) => {
    try {
      const outlets = await db.pAll(
        "SELECT code, brand_code, region FROM outlets WHERE active = 1 ORDER BY brand_code, code",
      );
      const cats = await db.pAll(
        "SELECT department_code, name FROM categories WHERE active = 1 ORDER BY department_code, sort_order, name",
      );
      const categories = { IT: [], ME: [] };
      for (const c of cats)
        if (categories[c.department_code])
          categories[c.department_code].push(c.name);
      res.json({ outlets, categories });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load form data" });
    }
  },
);

// --- POST /api/public/upload -----------------------------------------------
// Optional attachment for a public report. Same magic-byte + size validation
// as the authenticated path; stored unlinked (ticket_id NULL, uploaded_by NULL)
// and linked to the ticket on submit. Rate-limited to curb abuse; the hourly
// orphan cleanup removes anything never linked.
router.post(
  "/api/public/upload",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const { path: tempPath, originalname, mimetype, size } = req.file;
    const err = validateFile(tempPath, mimetype, size);
    if (err) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return res.status(400).json({ error: err });
    }
    const sanitizedName = originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileId = crypto.randomUUID();
    const destPath = path.join(UPLOADS_DIR, fileId);
    try {
      fs.renameSync(tempPath, destPath);
    } catch (e) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return res.status(500).json({ error: "Failed to save file." });
    }
    const fileUrl = `/api/attachments/${fileId}`;
    try {
      await db.pRun(
        "INSERT INTO attachments (id, ticket_id, file_url, file_name, file_size, mime_type, uploaded_by) VALUES (?, NULL, ?, ?, ?, ?, NULL)",
        [fileId, fileUrl, sanitizedName, size, mimetype],
      );
      res
        .status(201)
        .json({ id: fileId, file_name: sanitizedName, file_size: size });
    } catch (e) {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      res.status(500).json({ error: "Failed to record upload." });
    }
  },
);

// --- POST /api/public/quick-report -----------------------------------------
router.post(
  "/api/public/quick-report",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
  async (req, res) => {
    try {
      const b = req.body || {};
      const department = String(b.department || "").toUpperCase();
      if (!DEPARTMENTS.includes(department))
        return res.status(400).json({ error: "Department must be IT or ME" });
      if (!b.outlet_code)
        return res.status(400).json({ error: "Outlet is required" });
      if (!b.category)
        return res.status(400).json({ error: "Category is required" });
      const description = String(b.description || "").trim();
      if (!description)
        return res
          .status(400)
          .json({ error: "A short issue description is required" });
      const reporterName = String(b.reporter_name || "").trim();
      if (!reporterName)
        return res.status(400).json({ error: "Reporter name is required" });
      const reporterContact = String(
        b.contact_number || b.reporter_contact || "",
      ).trim();
      if (!reporterContact)
        return res
          .status(400)
          .json({ error: "Contact / WhatsApp number is required" });

      // Category must belong to the chosen department.
      const cat = await db.pGet(
        "SELECT 1 FROM categories WHERE department_code = ? AND name = ?",
        [department, b.category],
      );
      if (!cat)
        return res.status(400).json({
          error: `Category "${b.category}" does not belong to ${department}`,
        });

      // Outlet must exist (and be active) → infer brand + region.
      const outlet = await db.pGet(
        "SELECT code, brand_code, region FROM outlets WHERE code = ? AND active = 1",
        [b.outlet_code],
      );
      if (!outlet) return res.status(400).json({ error: "Unknown outlet" });
      const brand_code = outlet.brand_code || null;
      const region = outlet.region || "Jakarta";

      const urgency = URGENCIES.includes(b.urgency) ? b.urgency : "Medium";
      const title = description.slice(0, 80);
      const ticketNumber = await nextTicketNumber(department);

      // Secure tracking token — only its sha256 hash is stored.
      const rawToken = crypto.randomBytes(24).toString("hex");
      const tokenHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");

      const r = await db.pRun(
        `INSERT INTO tickets
          (ticket_number, title, description, department, category, outlet_code, brand_code, region,
           status, urgency, report_mode, requestor_user_id, customer_name, contact_number,
           location_detail, scheduled_at, assignee_name, source,
           public_reporter_name, public_reporter_contact, tracking_token_hash, tracking_token_created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New', ?, 'quick', NULL, ?, ?, ?, ?, 'Unassigned', 'public_quick_report',
           ?, ?, ?, datetime('now'))`,
        [
          ticketNumber,
          title,
          description,
          department,
          b.category,
          outlet.code,
          brand_code,
          region,
          urgency,
          reporterName, // customer_name → shows in existing admin views
          reporterContact, // contact_number
          b.location_detail || null,
          b.scheduled_at || null,
          reporterName,
          reporterContact,
          tokenHash,
        ],
      );
      const ticketId = r.lastID;

      // Link any pre-uploaded PUBLIC attachments (uploaded_by NULL, unlinked).
      if (Array.isArray(b.attachmentIds) && b.attachmentIds.length) {
        const ids = b.attachmentIds.filter((x) => typeof x === "string").slice(0, 5);
        if (ids.length) {
          const ph = ids.map(() => "?").join(",");
          await db.pRun(
            `UPDATE attachments SET ticket_id = ? WHERE id IN (${ph}) AND ticket_id IS NULL AND uploaded_by IS NULL`,
            [ticketId, ...ids],
          );
        }
      }

      await logActivity(
        ticketId,
        null, // System actor
        "ticket.created",
        `Ticket created from Public Quick Report • ${ticketNumber} • ${department}/${b.category} • ${outlet.code}`,
      );

      // Notify department admins in-app (same as authenticated create).
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
      // WhatsApp acknowledgement to the reporter.
      const displayTicketNumber = outlet.code ? `${ticketNumber} - ${outlet.code}` : ticketNumber;
      notify("ticket.created", {
        ticketId,
        ticketNumber: displayTicketNumber,
        recipients: [{ name: reporterName, phone: reporterContact }],
        message: `Tiket pelaporan anda sudah dibuat. Nomor tiket anda: ${displayTicketNumber}`,
        channels: ["whatsapp"],
      });

      // Notify Technicians / WhatsApp Group
      const techGroupTarget = (department === 'ME' ? process.env.FONNTE_WA_GROUP_ME : process.env.FONNTE_WA_GROUP_IT) || process.env.FONNTE_WA_GROUP || '120363410098180945@g.us';
      const techWaRecipients = [];
      if (techGroupTarget) {
        techWaRecipients.push({ name: `${department} Technician Group`, phone: techGroupTarget });
      }
      const techsWithPhone = await db.pAll(
        `SELECT username, phone FROM users WHERE is_active = 1 AND phone IS NOT NULL AND phone != '' AND role IN ('SuperAdmin', ?, ?)`,
        [department === "IT" ? "AdminIT" : "AdminME", department === "IT" ? "TechnicianIT" : "TechnicianME"]
      );
      for (const t of techsWithPhone) {
        if (!techWaRecipients.some(r => r.phone === t.phone)) {
          techWaRecipients.push({ name: t.username, phone: t.phone });
        }
      }

      if (techWaRecipients.length > 0) {
        const groupAlertMessage = `🚨 *TIKET BARU (PUBLIC QUICK REPORT)* 🚨\n• *Nomor Tiket*: ${displayTicketNumber}\n• *Departemen*: ${department}\n• *Kategori*: ${b.category || '—'}\n• *Outlet*: ${outlet.code || '—'}\n• *Pelapor*: ${reporterName}${reporterContact ? ' (' + reporterContact + ')' : ''}\n• *Judul*: ${b.title || '—'}\n• *Deskripsi*: ${b.description || '—'}`;
        notify("ticket.created", {
          ticketId,
          ticketNumber: displayTicketNumber,
          recipients: techWaRecipients,
          message: groupAlertMessage,
          channels: ["whatsapp"],
        });
      }

      // Public-safe response only.
      res.status(201).json({
        ticket_number: ticketNumber,
        status: "New",
        created_at: new Date().toISOString(),
        tracking_token: rawToken,
        track_url: `/track/${ticketNumber}?token=${rawToken}`,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create ticket" });
    }
  },
);

// --- GET /api/public/track/:ticket_number?token=... ------------------------
// Public-safe status lookup, gated by the secret token. Returns no internal
// comments, notes, user data, or other tickets.
router.get(
  "/api/public/track/:ticket_number",
  rateLimit({ windowMs: 60 * 1000, max: 30 }),
  async (req, res) => {
    try {
      const token = String(req.query.token || "");
      if (!token)
        return res.status(400).json({ error: "Tracking token required" });
      const hash = crypto.createHash("sha256").update(token).digest("hex");
      const t = await db.pGet(
        `SELECT id, ticket_number, status, department, outlet_code, region, created_at, updated_at
         FROM tickets WHERE ticket_number = ? AND tracking_token_hash = ?`,
        [req.params.ticket_number, hash],
      );
      if (!t)
        return res
          .status(404)
          .json({ error: "Ticket not found or invalid token" });
      res.json({
        ticket_number: t.ticket_number,
        status: t.status,
        department: t.department,
        outlet: t.outlet_code,
        region: t.region,
        created_at: t.created_at,
        last_update_at: t.updated_at || t.created_at,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to track ticket" });
    }
  },
);

module.exports = router;
