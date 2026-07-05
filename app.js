/* ==========================================================================
   IT-ME Ticketing — Backend (Express + SQLite)
   ========================================================================== */
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./database");
const {
  recommendTechnicians,
  OPEN_ASSIGNED_STATUSES,
} = require("./services/recommend");
const { notify } = require("./services/notifications");

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "union-dev-secret-change-me";
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET must be set in production.");
  process.exit(1);
}

// --- Domain constants ------------------------------------------------------
const STATUSES = [
  "New",
  "Open",
  "Assigned",
  "On Progress",
  "Waiting Sparepart",
  "Waiting Vendor",
  "Pending Outlet Response",
  "Escalated",
  "Resolved",
  "Closed",
  "Cancelled",
];
const URGENCIES = ["Low", "Medium", "High", "Critical"];
const DEPARTMENTS = ["IT", "ME"];
const ADMIN_ROLES = ["SuperAdmin", "AdminIT", "AdminME"];

// --- Uploads ---------------------------------------------------------------
const UPLOADS_DIR = path.join(__dirname, "uploads");
const TEMP_DIR = path.join(UPLOADS_DIR, "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
const upload = multer({ dest: TEMP_DIR });

// --- Middleware ------------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));

// --- Simple in-memory rate limiter (auth endpoints) ------------------------
const rateBuckets = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res
        .status(429)
        .json({
          error: "Too many attempts. Please slow down and try again shortly.",
        });
    }
    next();
  };
}

// --- Auth helpers ----------------------------------------------------------
function signToken(user) {
  const absoluteExp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      department: user.department,
      brand: user.brand,
      all_brands: user.all_brands,
      can_close_override: user.can_close_override,
      absolute_exp: absoluteExp,
    },
    JWT_SECRET,
  );
}
function setSessionCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 30 * 60 * 1000,
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token)
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      res.clearCookie("token");
      return res
        .status(401)
        .json({ error: "Unauthorized. Session expired or invalid." });
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (decoded.absolute_exp && nowSeconds > decoded.absolute_exp) {
      res.clearCookie("token");
      return res
        .status(401)
        .json({ error: "Unauthorized. Session absolute lifetime expired." });
    }
    setSessionCookie(res, token); // sliding window
    req.user = decoded;
    next();
  });
}

function requireRole(...allowedRoles) {
  const roles = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized." });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden. Access denied." });
    }
    next();
  };
}

// --- Role predicates -------------------------------------------------------
const deptForRole = (role) =>
  role === "AdminIT" || role === "TechnicianIT"
    ? "IT"
    : role === "AdminME" || role === "TechnicianME"
      ? "ME"
      : null;
const isAdmin = (u) => ADMIN_ROLES.includes(u.role);
const isTechnician = (u) =>
  u.role === "TechnicianIT" || u.role === "TechnicianME";

// Can this user administer (edit/assign/close) this ticket's department?
function adminScopeForTicket(u, ticket) {
  if (u.role === "SuperAdmin") return true;
  if (u.role === "AdminIT") return ticket.department === "IT";
  if (u.role === "AdminME") return ticket.department === "ME";
  return false;
}
function canClose(u, ticket) {
  if (adminScopeForTicket(u, ticket)) return true;
  if (
    isTechnician(u) &&
    u.can_close_override &&
    ticket.assigned_technician_id === u.id
  )
    return true;
  return false;
}

// Load a user's brand/outlet access sets (cached per-request via req).
async function getUserScope(user) {
  if (user.all_brands || user.role === "SuperAdmin")
    return { allBrands: true, brands: [], outlets: [] };
  const brands = (
    await db.pAll(
      "SELECT brand_code FROM user_brand_access WHERE user_id = ?",
      [user.id],
    )
  ).map((r) => r.brand_code);
  if (user.brand && !brands.includes(user.brand)) brands.push(user.brand);
  const outlets = (
    await db.pAll(
      "SELECT outlet_code FROM user_outlet_access WHERE user_id = ?",
      [user.id],
    )
  ).map((r) => r.outlet_code);
  return { allBrands: false, brands, outlets };
}

// Build a WHERE clause fragment scoping the tickets table to what `user` may see.
async function buildTicketScope(user) {
  const clauses = [];
  const params = [];

  // Department scope (admins/technicians of a department)
  const dept = deptForRole(user.role);

  if (user.role === "SuperAdmin") {
    // no restriction
  } else if (user.role === "Requestor") {
    clauses.push("(requestor_user_id = ? OR LOWER(customer_email) = LOWER(?))");
    params.push(user.id, user.email);
  } else if (isTechnician(user)) {
    clauses.push("assigned_technician_id = ?");
    params.push(user.id);
  } else if (user.role === "AdminIT" || user.role === "AdminME") {
    clauses.push("department = ?");
    params.push(dept);
  } else if (user.role === "Leader") {
    // view-only; brand/outlet scoped below
  }

  // Brand/outlet scope for admins & leaders (not requestor/technician which are already narrow)
  if (["AdminIT", "AdminME", "Leader"].includes(user.role)) {
    const scope = await getUserScope(user);
    if (!scope.allBrands) {
      const parts = [];
      if (scope.brands.length) {
        parts.push(`brand_code IN (${scope.brands.map(() => "?").join(",")})`);
        params.push(...scope.brands);
      }
      if (scope.outlets.length) {
        parts.push(
          `outlet_code IN (${scope.outlets.map(() => "?").join(",")})`,
        );
        params.push(...scope.outlets);
      }
      if (parts.length) clauses.push(`(${parts.join(" OR ")})`);
      else clauses.push("1=0"); // scoped user with no access sees nothing
    }
  }

  return { clause: clauses.length ? clauses.join(" AND ") : "1=1", params };
}

// --- Activity log helper ---------------------------------------------------
async function logActivity(ticketId, actor, action, detail) {
  await db.pRun(
    `INSERT INTO ticket_activity_logs (ticket_id, actor_user_id, actor_name, actor_role, action, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      ticketId,
      actor ? actor.id : null,
      actor ? actor.username : "System",
      actor ? actor.role : "System",
      action,
      detail || null,
    ],
  );
}

// ==========================================================================
// Auth
// ==========================================================================
app.post(
  "/api/auth/register",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
  async (req, res) => {
    try {
      const {
        username,
        email,
        password,
        passwordConfirm,
        brand,
        outlet,
        phone,
      } = req.body;
      if (!username || !email || !password || !passwordConfirm) {
        return res.status(400).json({ error: "All fields are required" });
      }
      if (password !== passwordConfirm)
        return res.status(400).json({ error: "Passwords do not match" });
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email))
        return res.status(400).json({ error: "Invalid email address format" });
      const passwordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{10,}$/;
      if (!passwordRegex.test(password))
        return res
          .status(400)
          .json({ error: "Password does not meet complexity requirements" });

      const existing = await db.pGet(
        "SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)",
        [email, username],
      );
      if (existing)
        return res
          .status(400)
          .json({ error: "Username or email already in use" });

      const passwordHash = bcrypt.hashSync(password, 10);
      // Self-registration always creates a Requestor.
      const r = await db.pRun(
        `INSERT INTO users (username, email, password_hash, role, brand, default_outlet_code, phone)
       VALUES (?, ?, ?, 'Requestor', ?, ?, ?)`,
        [
          username,
          email.toLowerCase(),
          passwordHash,
          brand || null,
          outlet || null,
          phone || null,
        ],
      );
      if (brand)
        await db.pRun(
          "INSERT OR IGNORE INTO user_brand_access (user_id, brand_code) VALUES (?, ?)",
          [r.lastID, brand],
        );
      if (outlet)
        await db.pRun(
          "INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)",
          [r.lastID, outlet],
        );
      res
        .status(201)
        .json({ message: "Registration successful! Please log in." });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to register user" });
    }
  },
);

app.post(
  "/api/auth/login",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
  async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return res
          .status(400)
          .json({ error: "Email and password are required" });

      const user = await db.pGet(
        "SELECT * FROM users WHERE LOWER(email) = LOWER(?)",
        [email],
      );
      // Generic error to avoid user enumeration.
      const GENERIC = "Invalid email or password";
      if (!user) return res.status(401).json({ error: GENERIC });

      // Account lockout check
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res
          .status(423)
          .json({
            error:
              "Account temporarily locked due to failed attempts. Try again later.",
          });
      }
      if (user.is_active === 0)
        return res
          .status(403)
          .json({ error: "Account is inactive. Contact an administrator." });

      if (!bcrypt.compareSync(password, user.password_hash)) {
        const attempts = (user.failed_attempts || 0) + 1;
        const lockFor =
          attempts >= 5
            ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
            : null;
        await db.pRun(
          "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?",
          [attempts, lockFor, user.id],
        );
        return res.status(401).json({ error: GENERIC });
      }

      // Success — reset lockout counters.
      await db.pRun(
        "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?",
        [user.id],
      );
      const token = signToken(user);
      setSessionCookie(res, token);
      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        department: user.department,
        brand: user.brand,
        all_brands: user.all_brands,
        can_close_override: user.can_close_override,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Database error" });
    }
  },
);

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true, message: "Logged out successfully" });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    email: req.user.email,
    role: req.user.role,
    department: req.user.department,
    brand: req.user.brand,
    all_brands: req.user.all_brands,
    can_close_override: req.user.can_close_override,
  });
});

// ==========================================================================
// Reference / meta
// ==========================================================================
app.get("/api/meta/brands", requireAuth, async (req, res) => {
  res.json(
    await db.pAll(
      "SELECT code, name FROM brands WHERE active = 1 ORDER BY code",
    ),
  );
});
app.get("/api/meta/outlets", requireAuth, async (req, res) => {
  const rows = await db.pAll(
    "SELECT code, name, brand_code, display_label FROM outlets WHERE active = 1 ORDER BY brand_code, code",
  );
  res.json(rows);
});
app.get("/api/meta/departments", requireAuth, (req, res) => {
  res.json(DEPARTMENTS.map((code) => ({ code })));
});
app.get("/api/meta/categories", requireAuth, async (req, res) => {
  const { department } = req.query;
  const params = [];
  let sql = "SELECT department_code, name FROM categories WHERE active = 1";
  if (department) {
    sql += " AND department_code = ?";
    params.push(department);
  }
  sql += " ORDER BY sort_order, name";
  res.json(await db.pAll(sql, params));
});

// ==========================================================================
// Category Management API Endpoints (RBAC Enforced)
// Allowed roles: SuperAdmin, AdminIT, AdminME, TechnicianIT, TechnicianME
// ==========================================================================
app.get(
  "/api/categories",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const sql = "SELECT * FROM categories ORDER BY department_code, sort_order, name";
      const rows = await db.pAll(sql);
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  }
);

app.post(
  "/api/categories",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const dept = String(req.body.department_code || "").toUpperCase();
      if (!DEPARTMENTS.includes(dept)) {
        return res.status(400).json({ error: "Department code must be IT or ME" });
      }
      const name = String(req.body.name || "").trim();
      if (!name) {
        return res.status(400).json({ error: "Category name is required" });
      }

      // Check for duplicate category name within the same department
      const existing = await db.pGet(
        "SELECT id FROM categories WHERE department_code = ? AND LOWER(name) = LOWER(?)",
        [dept, name]
      );
      if (existing) {
        return res.status(400).json({ error: "Category already exists in this department" });
      }

      const active = req.body.active !== false ? 1 : 0;
      const sortOrder = Number(req.body.sort_order) || 0;

      const r = await db.pRun(
        "INSERT INTO categories (department_code, name, active, sort_order) VALUES (?, ?, ?, ?)",
        [dept, name, active, sortOrder]
      );
      const newCat = await db.pGet("SELECT * FROM categories WHERE id = ?", [r.lastID]);
      res.status(201).json(newCat);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create category" });
    }
  }
);

app.patch(
  "/api/categories/:id",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid category ID" });

      const cat = await db.pGet("SELECT * FROM categories WHERE id = ?", [id]);
      if (!cat) return res.status(404).json({ error: "Category not found" });

      const updates = [];
      const params = [];
      const set = (col, val) => {
        updates.push(`${col} = ?`);
        params.push(val);
      };

      if (req.body.department_code !== undefined) {
        const dept = String(req.body.department_code || "").toUpperCase();
        if (!DEPARTMENTS.includes(dept)) {
          return res.status(400).json({ error: "Department code must be IT or ME" });
        }
        set("department_code", dept);
      }

      if (req.body.name !== undefined) {
        const name = String(req.body.name || "").trim();
        if (!name) return res.status(400).json({ error: "Category name is required" });
        set("name", name);
      }

      if (req.body.active !== undefined) {
        set("active", req.body.active ? 1 : 0);
      }

      if (req.body.sort_order !== undefined) {
        set("sort_order", Number(req.body.sort_order) || 0);
      }

      if (!updates.length) return res.status(400).json({ error: "No fields to update" });

      // Check unique constraint if name or department changes
      const checkDept = req.body.department_code !== undefined ? String(req.body.department_code).toUpperCase() : cat.department_code;
      const checkName = req.body.name !== undefined ? String(req.body.name).trim() : cat.name;
      if (req.body.department_code !== undefined || req.body.name !== undefined) {
        const existing = await db.pGet(
          "SELECT id FROM categories WHERE department_code = ? AND LOWER(name) = LOWER(?) AND id != ?",
          [checkDept, checkName, id]
        );
        if (existing) {
          return res.status(400).json({ error: "Another category with this name already exists in this department" });
        }
      }

      await db.pRun(`UPDATE categories SET ${updates.join(", ")} WHERE id = ?`, [...params, id]);
      const updated = await db.pGet("SELECT * FROM categories WHERE id = ?", [id]);
      res.json(updated);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update category" });
    }
  }
);

app.delete(
  "/api/categories/:id",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid category ID" });

      const r = await db.pRun("DELETE FROM categories WHERE id = ?", [id]);
      if (r.changes === 0) return res.status(404).json({ error: "Category not found" });
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete category" });
    }
  }
);

// ==========================================================================================================
// Tickets
// ==========================================================================
async function nextTicketNumber(department) {
  const year = new Date().getFullYear();
  await db.pRun(
    `INSERT INTO ticket_counters (department_code, year, last_seq) VALUES (?, ?, 1)
     ON CONFLICT(department_code, year) DO UPDATE SET last_seq = last_seq + 1`,
    [department, year],
  );
  const row = await db.pGet(
    "SELECT last_seq FROM ticket_counters WHERE department_code = ? AND year = ?",
    [department, year],
  );
  return `${department}-${year}-${String(row.last_seq).padStart(4, "0")}`;
}

// double-submit guard (very short window)
const recentCreates = new Map();

app.post("/api/tickets", requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const department = String(b.department || "").toUpperCase();
    if (!DEPARTMENTS.includes(department))
      return res.status(400).json({ error: "Department must be IT or ME" });
    if (!b.outlet_code)
      return res.status(400).json({ error: "Outlet is required" });
    if (!b.category)
      return res.status(400).json({ error: "Category is required" });
    if (!b.description && !b.title)
      return res
        .status(400)
        .json({ error: "A short issue description is required" });

    // Validate category belongs to department.
    const cat = await db.pGet(
      "SELECT 1 FROM categories WHERE department_code = ? AND name = ?",
      [department, b.category],
    );
    if (!cat)
      return res
        .status(400)
        .json({
          error: `Category "${b.category}" does not belong to ${department}`,
        });

    // Derive brand from outlet.
    const outlet = await db.pGet(
      "SELECT code, brand_code FROM outlets WHERE code = ?",
      [b.outlet_code],
    );
    if (!outlet) return res.status(400).json({ error: "Unknown outlet" });
    const brand_code = outlet.brand_code || null;

    const urgency = URGENCIES.includes(b.urgency) ? b.urgency : "Medium";
    const reportMode = b.report_mode === "detailed" ? "detailed" : "quick";

    // Requestor identity is always taken from the authenticated user.
    const requestorName =
      isAdmin(req.user) && b.customer_name
        ? b.customer_name
        : req.user.username;
    const requestorEmail =
      isAdmin(req.user) && b.customer_email ? b.customer_email : req.user.email;

    // Double-click guard: same user + outlet + category + text within 8s → reject softly.
    const fp = crypto
      .createHash("sha1")
      .update(
        `${req.user.id}|${b.outlet_code}|${b.category}|${b.description || b.title || ""}`,
      )
      .digest("hex");
    const last = recentCreates.get(fp);
    if (last && Date.now() - last < 8000) {
      return res
        .status(409)
        .json({
          error: "Looks like a duplicate submission — please wait a moment.",
        });
    }
    recentCreates.set(fp, Date.now());

    const title =
      b.title ||
      (b.description
        ? String(b.description).slice(0, 80)
        : `${b.category} issue`);
    const ticketNumber = await nextTicketNumber(department);

    const r = await db.pRun(
      `INSERT INTO tickets
        (ticket_number, title, description, department, category, outlet_code, brand_code,
         status, urgency, report_mode, requestor_user_id, customer_name, customer_email,
         contact_person, contact_number, location_detail, device_equipment, business_impact,
         preferred_visit_time, occurrence_at, assignee_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'New', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Unassigned')`,
      [
        ticketNumber,
        title,
        b.description || title,
        department,
        b.category,
        outlet.code,
        brand_code,
        urgency,
        reportMode,
        req.user.id,
        requestorName,
        requestorEmail,
        b.contact_person || requestorName,
        b.contact_number || null,
        b.location_detail || null,
        b.device_equipment || null,
        b.business_impact || null,
        b.preferred_visit_time || null,
        b.occurrence_at || null,
      ],
    );
    const ticketId = r.lastID;

    // Link any pre-uploaded attachments.
    if (Array.isArray(b.attachmentIds) && b.attachmentIds.length) {
      const ph = b.attachmentIds.map(() => "?").join(",");
      await db.pRun(
        `UPDATE attachments SET ticket_id = ? WHERE id IN (${ph}) AND ticket_id IS NULL`,
        [ticketId, ...b.attachmentIds],
      );
    }

    await logActivity(
      ticketId,
      req.user,
      "ticket.created",
      `${ticketNumber} • ${department}/${b.category} • ${outlet.code}`,
    );

    // Notify department admins (in-app).
    const admins = await db.pAll(
      `SELECT username, email, phone FROM users WHERE is_active = 1 AND role IN ('SuperAdmin', ?)`,
      [department === "IT" ? "AdminIT" : "AdminME"],
    );
    notify("ticket.created", {
      ticketId,
      recipients: admins,
      message: `New ${department} ticket ${ticketNumber}`,
      channels: ["in_app"],
    });

    const ticket = await db.pGet("SELECT * FROM tickets WHERE id = ?", [
      ticketId,
    ]);
    res.status(201).json(ticket);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create ticket" });
  }
});

app.get("/api/tickets", requireAuth, async (req, res) => {
  try {
    const scope = await buildTicketScope(req.user);
    const {
      status,
      priority,
      urgency,
      department,
      brand,
      outlet,
      category,
      search,
    } = req.query;
    let sql = `SELECT * FROM tickets WHERE ${scope.clause}`;
    const params = [...scope.params];
    const add = (frag, ...vals) => {
      sql += frag;
      params.push(...vals);
    };

    if (status) add(" AND status = ?", status);
    if (urgency) add(" AND urgency = ?", urgency);
    if (priority) add(" AND urgency = ?", priority); // legacy alias
    if (department && DEPARTMENTS.includes(department))
      add(" AND department = ?", department);
    if (brand) add(" AND brand_code = ?", brand);
    if (outlet) add(" AND outlet_code = ?", outlet);
    if (category) add(" AND category = ?", category);
    if (search) {
      add(
        " AND (title LIKE ? OR description LIKE ? OR ticket_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)",
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
      );
    }
    sql += ` ORDER BY CASE urgency WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END ASC, created_at DESC`;
    res.json(await db.pAll(sql, params));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// helper: fetch a ticket the user is allowed to see, or null
async function getVisibleTicket(user, id) {
  const scope = await buildTicketScope(user);
  return db.pGet(`SELECT * FROM tickets WHERE id = ? AND ${scope.clause}`, [
    id,
    ...scope.params,
  ]);
}

app.get("/api/tickets/:id", requireAuth, async (req, res) => {
  try {
    const ticket = await getVisibleTicket(req.user, req.params.id);
    if (!ticket)
      return res
        .status(404)
        .json({ error: "Ticket not found or access denied" });
    const comments = await db.pAll(
      "SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC",
      [ticket.id],
    );
    const activity = await db.pAll(
      "SELECT * FROM ticket_activity_logs WHERE ticket_id = ? ORDER BY created_at ASC",
      [ticket.id],
    );
    const attachments = await db.pAll(
      "SELECT * FROM attachments WHERE ticket_id = ?",
      [ticket.id],
    );
    const assignments = await db.pAll(
      `SELECT a.*, u.username AS technician_name FROM ticket_assignments a
       LEFT JOIN users u ON u.id = a.technician_id WHERE a.ticket_id = ? ORDER BY a.assigned_at DESC`,
      [ticket.id],
    );
    res.json({ ticket, comments, activity, attachments, assignments });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch ticket" });
  }
});

// --- Status transition validation -----------------------------------------
function validateTransition(ticket, next, body, user) {
  if (!STATUSES.includes(next)) return "Invalid status value";
  if (
    next === "Resolved" &&
    !(body.resolution_note || ticket.resolution_note)
  ) {
    return "A resolution note describing the action taken is required to mark Resolved";
  }
  if (next === "Closed" && !(body.resolution_note || ticket.resolution_note)) {
    return "A resolution note is required before closing";
  }
  if (next === "Cancelled" && !body.cancel_reason) {
    return "A cancellation reason is required";
  }
  if (next === "On Progress" && !ticket.assigned_technician_id) {
    return "Assign a technician before starting work";
  }
  if (ticket.status === "Closed" && next !== "Closed") {
    // reopening
    if (!isAdmin(user)) return "Only an admin can reopen a closed ticket";
    if (!body.reopen_reason && !body.reason)
      return "A reason is required to reopen a closed ticket";
  }
  return null;
}

app.patch("/api/tickets/:id", requireAuth, async (req, res) => {
  try {
    const ticket = await getVisibleTicket(req.user, req.params.id);
    if (!ticket)
      return res
        .status(404)
        .json({ error: "Ticket not found or access denied" });

    const b = req.body || {};
    const isDeptAdmin = adminScopeForTicket(req.user, ticket);
    const isAssignedTech =
      isTechnician(req.user) && ticket.assigned_technician_id === req.user.id;
    if (!isDeptAdmin && !isAssignedTech) {
      return res
        .status(403)
        .json({ error: "You do not have permission to edit this ticket" });
    }

    const updates = [];
    const params = [];
    const set = (col, val) => {
      updates.push(`${col} = ?`);
      params.push(val);
    };
    const activities = [];

    // Status change (with guards + timestamps)
    if (b.status && b.status !== ticket.status) {
      // Technicians limited to a safe subset.
      const techAllowed = [
        "On Progress",
        "Waiting Sparepart",
        "Waiting Vendor",
        "Pending Outlet Response",
        "Escalated",
        "Resolved",
      ];
      if (isAssignedTech && !isDeptAdmin && !techAllowed.includes(b.status)) {
        return res
          .status(403)
          .json({ error: "Technicians cannot set that status" });
      }
      if (b.status === "Closed" && !canClose(req.user, ticket)) {
        return res
          .status(403)
          .json({ error: "Only an admin can close a ticket" });
      }
      const err = validateTransition(ticket, b.status, b, req.user);
      if (err) return res.status(400).json({ error: err });

      set("status", b.status);
      const nowIso = new Date().toISOString();
      if (b.status === "On Progress" && !ticket.started_at)
        set("started_at", nowIso);
      if (b.status === "Resolved" && !ticket.resolved_at)
        set("resolved_at", nowIso);
      if (b.status === "Closed" && !ticket.closed_at) set("closed_at", nowIso);
      if (ticket.status === "Closed" && b.status !== "Closed")
        set("closed_at", null);
      activities.push(["status.changed", `${ticket.status} → ${b.status}`]);
    }

    if (
      b.urgency &&
      URGENCIES.includes(b.urgency) &&
      b.urgency !== ticket.urgency
    ) {
      if (!isDeptAdmin)
        return res
          .status(403)
          .json({ error: "Only admins can change urgency" });
      set("urgency", b.urgency);
      activities.push(["urgency.changed", `${ticket.urgency} → ${b.urgency}`]);
    }

    // Department / category re-routing (admin only)
    if (
      b.department &&
      DEPARTMENTS.includes(b.department) &&
      b.department !== ticket.department
    ) {
      if (!isDeptAdmin)
        return res
          .status(403)
          .json({ error: "Only admins can re-route department" });
      set("department", b.department);
      activities.push([
        "department.changed",
        `${ticket.department} → ${b.department} (escalation)`,
      ]);
      // keep original ticket_number (same-ticket escalation), clear assignee if wrong dept
    }
    if (b.category) {
      const dept = b.department || ticket.department;
      const ok = await db.pGet(
        "SELECT 1 FROM categories WHERE department_code = ? AND name = ?",
        [dept, b.category],
      );
      if (!ok)
        return res
          .status(400)
          .json({ error: "Category does not belong to the ticket department" });
      if (b.category !== ticket.category) {
        set("category", b.category);
        activities.push([
          "category.changed",
          `${ticket.category} → ${b.category}`,
        ]);
      }
    }
    if (b.outlet_code && b.outlet_code !== ticket.outlet_code) {
      if (!isDeptAdmin)
        return res.status(403).json({ error: "Only admins can change outlet" });
      const o = await db.pGet("SELECT brand_code FROM outlets WHERE code = ?", [
        b.outlet_code,
      ]);
      if (!o) return res.status(400).json({ error: "Unknown outlet" });
      set("outlet_code", b.outlet_code);
      set("brand_code", o.brand_code);
      activities.push([
        "outlet.changed",
        `${ticket.outlet_code} → ${b.outlet_code}`,
      ]);
    }

    // Free-text operational fields
    const textFields = [
      "resolution_note",
      "cancel_reason",
      "sparepart_note",
      "vendor_note",
      "expected_part_date",
      "estimated_cost",
      "location_detail",
      "device_equipment",
      "business_impact",
      "contact_number",
      "preferred_visit_time",
    ];
    for (const f of textFields) {
      if (b[f] !== undefined && b[f] !== ticket[f]) set(f, b[f]);
    }

    if (!updates.length)
      return res.status(400).json({ error: "No changes provided" });
    set("updated_at", new Date().toISOString());
    if (!ticket.first_response_at && isDeptAdmin)
      set("first_response_at", new Date().toISOString());

    await db.pRun(`UPDATE tickets SET ${updates.join(", ")} WHERE id = ?`, [
      ...params,
      ticket.id,
    ]);
    for (const [action, detail] of activities)
      await logActivity(ticket.id, req.user, action, detail);

    const updated = await db.pGet("SELECT * FROM tickets WHERE id = ?", [
      ticket.id,
    ]);
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update ticket" });
  }
});

// --- Recommendation --------------------------------------------------------
app.get(
  "/api/tickets/:id/recommend",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const ticket = await getVisibleTicket(req.user, req.params.id);
      if (!ticket)
        return res
          .status(404)
          .json({ error: "Ticket not found or access denied" });
      if (!adminScopeForTicket(req.user, ticket))
        return res.status(403).json({ error: "Wrong department" });
      const recs = await recommendTechnicians(db, {
        department: ticket.department,
        categoryName: ticket.category,
      });
      res.json(recs);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to compute recommendation" });
    }
  },
);

// --- Assign / reassign -----------------------------------------------------
app.post(
  "/api/tickets/:id/assign",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const ticket = await getVisibleTicket(req.user, req.params.id);
      if (!ticket)
        return res
          .status(404)
          .json({ error: "Ticket not found or access denied" });
      if (!adminScopeForTicket(req.user, ticket))
        return res.status(403).json({ error: "Wrong department" });

      const { technician_id, reason, override } = req.body || {};
      const tech = await db.pGet(
        "SELECT id, username, department, role, is_active FROM users WHERE id = ?",
        [technician_id],
      );
      if (!tech || !isTechnician({ role: tech.role }))
        return res.status(400).json({ error: "Not a valid technician" });
      if (tech.is_active === 0)
        return res.status(400).json({ error: "Technician is inactive" });

      const techDept = deptForRole(tech.role);
      if (techDept !== ticket.department && !override) {
        return res
          .status(400)
          .json({
            error: `Technician is ${techDept}, ticket is ${ticket.department}. Use override to force.`,
          });
      }

      // Close previous active assignment, open a new one.
      await db.pRun(
        "UPDATE ticket_assignments SET active = 0, unassigned_at = CURRENT_TIMESTAMP WHERE ticket_id = ? AND active = 1",
        [ticket.id],
      );
      await db.pRun(
        "INSERT INTO ticket_assignments (ticket_id, technician_id, assigned_by, reason) VALUES (?, ?, ?, ?)",
        [ticket.id, tech.id, req.user.id, reason || null],
      );

      const newStatus = ["New", "Open"].includes(ticket.status)
        ? "Assigned"
        : ticket.status;
      await db.pRun(
        `UPDATE tickets SET assigned_technician_id = ?, assignee_name = ?, status = ?,
         assigned_at = COALESCE(assigned_at, CURRENT_TIMESTAMP),
         first_response_at = COALESCE(first_response_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
        [tech.id, tech.username, newStatus, ticket.id],
      );
      await logActivity(
        ticket.id,
        req.user,
        "ticket.assigned",
        `Assigned to ${tech.username}${override && techDept !== ticket.department ? " (override)" : ""}${reason ? " — " + reason : ""}`,
      );
      notify("ticket.assigned", {
        ticketId: ticket.id,
        recipients: [
          { name: tech.username, email: tech.email, phone: tech.phone },
        ],
        message: `You were assigned ${ticket.ticket_number}`,
        channels: ["in_app"],
      });

      res.json(
        await db.pGet("SELECT * FROM tickets WHERE id = ?", [ticket.id]),
      );
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to assign technician" });
    }
  },
);

// --- Comments (human) ------------------------------------------------------
app.post("/api/tickets/:id/comments", requireAuth, async (req, res) => {
  try {
    const ticket = await getVisibleTicket(req.user, req.params.id);
    if (!ticket)
      return res
        .status(404)
        .json({ error: "Ticket not found or access denied" });
    // Leaders are strictly view-only.
    if (req.user.role === "Leader")
      return res.status(403).json({ error: "View-only role cannot comment" });

    const { message, attachmentIds, phase } = req.body || {};
    if (!message && !(Array.isArray(attachmentIds) && attachmentIds.length)) {
      return res
        .status(400)
        .json({ error: "A message or attachment is required" });
    }

    // Author identity is ALWAYS from the authenticated user (no spoofing).
    const r = await db.pRun(
      `INSERT INTO comments (ticket_id, author_name, author_role, author_user_id, message, is_system)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [
        ticket.id,
        req.user.username,
        req.user.role,
        req.user.id,
        message || "(attachment)",
      ],
    );
    const commentId = r.lastID;

    if (Array.isArray(attachmentIds) && attachmentIds.length) {
      const validPhase = ["before", "after", "general"].includes(phase)
        ? phase
        : "general";
      const ph = attachmentIds.map(() => "?").join(",");
      await db.pRun(
        `UPDATE attachments SET ticket_id = ?, comment_id = ?, phase = ? WHERE id IN (${ph})`,
        [ticket.id, commentId, validPhase, ...attachmentIds],
      );
    }

    // First agent/admin/tech response marks first_response_at.
    if (!ticket.first_response_at && req.user.role !== "Requestor") {
      await db.pRun(
        "UPDATE tickets SET first_response_at = CURRENT_TIMESTAMP WHERE id = ?",
        [ticket.id],
      );
    }
    await db.pRun(
      "UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [ticket.id],
    );
    await logActivity(
      ticket.id,
      req.user,
      "comment.added",
      message ? message.slice(0, 80) : "(attachment)",
    );

    res
      .status(201)
      .json(await db.pGet("SELECT * FROM comments WHERE id = ?", [commentId]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// ==========================================================================
// Technicians & schedules
// ==========================================================================
app.get(
  "/api/technicians",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const dept = req.query.department;
      let sql = `SELECT id, username, email, department, role, is_active FROM users
               WHERE role IN ('TechnicianIT','TechnicianME')`;
      const params = [];
      if (dept === "IT") {
        sql += " AND role = 'TechnicianIT'";
      } else if (dept === "ME") {
        sql += " AND role = 'TechnicianME'";
      }
      sql += " ORDER BY username";
      const techs = await db.pAll(sql, params);
      for (const t of techs) {
        const wl = await db.pGet(
          `SELECT COUNT(*) c FROM tickets WHERE assigned_technician_id = ? AND status IN (${OPEN_ASSIGNED_STATUSES.map(() => "?").join(",")})`,
          [t.id, ...OPEN_ASSIGNED_STATUSES],
        );
        t.workload = wl.c;
      }
      res.json(techs);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list technicians" });
    }
  },
);

function canManageTechnician(user, tech) {
  if (user.role === "SuperAdmin") return true;
  if (user.role === "AdminIT") return tech.role === "TechnicianIT";
  if (user.role === "AdminME") return tech.role === "TechnicianME";
  return false;
}

app.get(
  "/api/technicians/:id/schedules",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    const schedules = await db.pAll(
      "SELECT * FROM technician_schedules WHERE user_id = ? ORDER BY day_of_week",
      [req.params.id],
    );
    const unavailability = await db.pAll(
      "SELECT * FROM technician_unavailability WHERE user_id = ? ORDER BY start_datetime DESC",
      [req.params.id],
    );
    res.json({ schedules, unavailability });
  },
);

app.post(
  "/api/technicians/:id/schedules",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const tech = await db.pGet("SELECT id, role FROM users WHERE id = ?", [
        req.params.id,
      ]);
      if (!tech) return res.status(404).json({ error: "Technician not found" });
      if (!canManageTechnician(req.user, tech))
        return res
          .status(403)
          .json({ error: "Not permitted for this department" });
      const { day_of_week, start_time, end_time } = req.body || {};
      if (day_of_week == null || !start_time || !end_time)
        return res
          .status(400)
          .json({ error: "day_of_week, start_time, end_time required" });
      const r = await db.pRun(
        "INSERT INTO technician_schedules (user_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)",
        [tech.id, day_of_week, start_time, end_time],
      );
      res
        .status(201)
        .json(
          await db.pGet("SELECT * FROM technician_schedules WHERE id = ?", [
            r.lastID,
          ]),
        );
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to save schedule" });
    }
  },
);

app.delete(
  "/api/technicians/:id/schedules/:sid",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    const tech = await db.pGet("SELECT id, role FROM users WHERE id = ?", [
      req.params.id,
    ]);
    if (!tech || !canManageTechnician(req.user, tech))
      return res.status(403).json({ error: "Not permitted" });
    await db.pRun(
      "DELETE FROM technician_schedules WHERE id = ? AND user_id = ?",
      [req.params.sid, req.params.id],
    );
    res.json({ success: true });
  },
);

app.post(
  "/api/technicians/:id/unavailability",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    const tech = await db.pGet("SELECT id, role FROM users WHERE id = ?", [
      req.params.id,
    ]);
    if (!tech || !canManageTechnician(req.user, tech))
      return res.status(403).json({ error: "Not permitted" });
    const { start_datetime, end_datetime, reason } = req.body || {};
    if (!start_datetime || !end_datetime)
      return res
        .status(400)
        .json({ error: "start_datetime and end_datetime required" });
    const r = await db.pRun(
      "INSERT INTO technician_unavailability (user_id, start_datetime, end_datetime, reason) VALUES (?, ?, ?, ?)",
      [tech.id, start_datetime, end_datetime, reason || null],
    );
    res
      .status(201)
      .json(
        await db.pGet("SELECT * FROM technician_unavailability WHERE id = ?", [
          r.lastID,
        ]),
      );
  },
);

// ==========================================================================
// Dashboard (role-aware aggregates)
// ==========================================================================
app.get("/api/dashboard", requireAuth, async (req, res) => {
  try {
    const scope = await buildTicketScope(req.user);
    const W = scope.clause;
    const P = scope.params;
    const one = async (sql, extra = []) =>
      (
        await db.pGet(`SELECT COUNT(*) c FROM tickets WHERE ${W}${sql}`, [
          ...P,
          ...extra,
        ])
      ).c;

    const byStatus = await db.pAll(
      `SELECT status, COUNT(*) c FROM tickets WHERE ${W} GROUP BY status`,
      P,
    );
    const byUrgency = await db.pAll(
      `SELECT urgency, COUNT(*) c FROM tickets WHERE ${W} GROUP BY urgency`,
      P,
    );
    const byDept = await db.pAll(
      `SELECT department, COUNT(*) c FROM tickets WHERE ${W} GROUP BY department`,
      P,
    );
    const byBrand = await db.pAll(
      `SELECT brand_code, COUNT(*) c FROM tickets WHERE ${W} GROUP BY brand_code`,
      P,
    );
    const byOutlet = await db.pAll(
      `SELECT outlet_code, COUNT(*) c FROM tickets WHERE ${W} GROUP BY outlet_code ORDER BY c DESC LIMIT 10`,
      P,
    );
    const topCategories = await db.pAll(
      `SELECT department, category, COUNT(*) c FROM tickets WHERE ${W} GROUP BY department, category ORDER BY c DESC LIMIT 8`,
      P,
    );

    const total = await one("");
    const open = await one(` AND status NOT IN ('Closed','Cancelled')`);
    const unassigned = await one(
      ` AND assigned_technician_id IS NULL AND status NOT IN ('Closed','Cancelled')`,
    );
    const waiting = await one(
      ` AND status IN ('Waiting Sparepart','Waiting Vendor')`,
    );

    // Avg resolution time (hrs) over resolved/closed with timestamps.
    const avg = await db.pGet(
      `SELECT AVG((julianday(COALESCE(closed_at, resolved_at)) - julianday(created_at)) * 24) h
       FROM tickets WHERE ${W} AND (resolved_at IS NOT NULL OR closed_at IS NOT NULL)`,
      P,
    );

    // Technician workload (admins only)
    let workload = [];
    if (isAdmin(req.user)) {
      const deptFilter =
        req.user.role === "AdminIT"
          ? "AND role='TechnicianIT'"
          : req.user.role === "AdminME"
            ? "AND role='TechnicianME'"
            : "AND role IN ('TechnicianIT','TechnicianME')";
      const techs = await db.pAll(
        `SELECT id, username, role FROM users WHERE is_active=1 ${deptFilter}`,
      );
      for (const t of techs) {
        const c = (
          await db.pGet(
            `SELECT COUNT(*) c FROM tickets WHERE assigned_technician_id=? AND status IN (${OPEN_ASSIGNED_STATUSES.map(() => "?").join(",")})`,
            [t.id, ...OPEN_ASSIGNED_STATUSES],
          )
        ).c;
        workload.push({
          technician: t.username,
          department: deptForRole(t.role),
          open: c,
        });
      }
      workload.sort((a, b) => b.open - a.open);
    }

    res.json({
      role: req.user.role,
      totals: { total, open, unassigned, waiting },
      avg_resolution_hours: avg && avg.h ? Math.round(avg.h * 10) / 10 : null,
      byStatus,
      byUrgency,
      byDept,
      byBrand,
      byOutlet,
      topCategories,
      workload,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to build dashboard" });
  }
});

// ==========================================================================
// Reports (server-side, scoped) + CSV export
// ==========================================================================
async function queryReport(user, q) {
  const scope = await buildTicketScope(user);
  let sql = `SELECT t.*, o.display_label AS outlet_display FROM tickets t
             LEFT JOIN outlets o ON o.code = t.outlet_code
             WHERE ${scope.clause.replace(/\b(requestor_user_id|customer_email|assigned_technician_id|department|brand_code|outlet_code)\b/g, "t.$1")}`;
  const params = [...scope.params];
  const add = (frag, ...v) => {
    sql += frag;
    params.push(...v);
  };
  if (q.department && DEPARTMENTS.includes(q.department))
    add(" AND t.department = ?", q.department);
  if (q.brand) add(" AND t.brand_code = ?", q.brand);
  if (q.outlet) add(" AND t.outlet_code = ?", q.outlet);
  if (q.status) add(" AND t.status = ?", q.status);
  if (q.category) add(" AND t.category = ?", q.category);
  if (q.urgency) add(" AND t.urgency = ?", q.urgency);
  if (q.technician) add(" AND t.assignee_name = ?", q.technician);
  if (q.start_date) add(" AND date(t.created_at) >= date(?)", q.start_date);
  if (q.end_date) add(" AND date(t.created_at) <= date(?)", q.end_date);
  sql += " ORDER BY t.created_at DESC";
  return db.pAll(sql, params);
}

app.get(
  "/api/reports/tickets",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "Leader"),
  async (req, res) => {
    try {
      if (
        req.query.start_date &&
        req.query.end_date &&
        req.query.start_date > req.query.end_date
      ) {
        return res
          .status(400)
          .json({ error: "Start date must be before end date" });
      }
      res.json(await queryReport(req.user, req.query));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to run report" });
    }
  },
);

app.get(
  "/api/reports/export",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "Leader"),
  async (req, res) => {
    try {
      const rows = await queryReport(req.user, req.query);
      const cols = [
        "ticket_number",
        "department",
        "category",
        "outlet_display",
        "brand_code",
        "status",
        "urgency",
        "customer_name",
        "assignee_name",
        "created_at",
        "resolved_at",
        "closed_at",
      ];
      const header = [
        "Ticket",
        "Dept",
        "Category",
        "Outlet",
        "Brand",
        "Status",
        "Urgency",
        "Requestor",
        "Assignee",
        "Created",
        "Resolved",
        "Closed",
      ];
      const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      let csv = "﻿" + header.join(",") + "\n";
      for (const r of rows) csv += cols.map((c) => esc(r[c])).join(",") + "\n";
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="report_${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(csv);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to export" });
    }
  },
);

// ==========================================================================
// User management (SuperAdmin)
// ==========================================================================
app.get(
  "/api/users",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    const rows = await db.pAll(
      `SELECT id, username, email, role, department, brand, all_brands, phone, is_active,
            can_close_override, default_outlet_code, created_at FROM users ORDER BY id ASC`,
    );
    res.json(rows);
  },
);

app.post(
  "/api/users",
  requireAuth,
  requireRole("SuperAdmin"),
  async (req, res) => {
    try {
      const {
        username,
        email,
        password,
        role,
        department,
        brand,
        all_brands,
        phone,
        is_active,
        can_close_override,
        default_outlet_code,
        brand_access,
        outlet_access,
      } = req.body;
      if (!username || !email || !password || !role)
        return res
          .status(400)
          .json({ error: "username, email, password, role are required" });
      if (!db.APP_ROLES.includes(role))
        return res.status(400).json({ error: "Invalid role" });
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email))
        return res.status(400).json({ error: "Invalid email" });
      const passwordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{10,}$/;
      if (!passwordRegex.test(password))
        return res
          .status(400)
          .json({ error: "Password does not meet complexity requirements" });
      const exists = await db.pGet(
        "SELECT id FROM users WHERE LOWER(email)=LOWER(?) OR LOWER(username)=LOWER(?)",
        [email, username],
      );
      if (exists)
        return res
          .status(400)
          .json({ error: "Username or email already in use" });

      const dept = deptForRole(role);
      const r = await db.pRun(
        `INSERT INTO users (username, email, password_hash, role, department, brand, all_brands, phone, is_active, can_close_override, default_outlet_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          username,
          email.toLowerCase(),
          bcrypt.hashSync(password, 10),
          role,
          department || dept,
          brand || null,
          all_brands ? 1 : 0,
          phone || null,
          is_active === 0 ? 0 : 1,
          can_close_override ? 1 : 0,
          default_outlet_code || null,
        ],
      );
      if (Array.isArray(brand_access))
        for (const bc of brand_access)
          await db.pRun(
            "INSERT OR IGNORE INTO user_brand_access (user_id, brand_code) VALUES (?, ?)",
            [r.lastID, bc],
          );
      if (Array.isArray(outlet_access))
        for (const oc of outlet_access)
          await db.pRun(
            "INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)",
            [r.lastID, oc],
          );
      res.status(201).json({ id: r.lastID, username, email, role });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create user" });
    }
  },
);

app.patch(
  "/api/users/:id",
  requireAuth,
  requireRole("SuperAdmin"),
  async (req, res) => {
    try {
      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId))
        return res.status(400).json({ error: "Invalid user ID" });
      const b = req.body || {};
      const updates = [];
      const params = [];
      const set = (c, v) => {
        updates.push(`${c} = ?`);
        params.push(v);
      };
      if (b.username) set("username", b.username);
      if (b.email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!re.test(b.email))
          return res.status(400).json({ error: "Invalid email" });
        set("email", b.email.toLowerCase());
      }
      if (b.role) {
        if (!db.APP_ROLES.includes(b.role))
          return res.status(400).json({ error: "Invalid role" });
        if (userId === req.user.id && b.role !== "SuperAdmin")
          return res
            .status(400)
            .json({ error: "You cannot change your own SuperAdmin role." });
        set("role", b.role);
        set("department", deptForRole(b.role));
      }
      if (b.password) {
        const re =
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{10,}$/;
        if (!re.test(b.password))
          return res
            .status(400)
            .json({ error: "Password does not meet complexity requirements" });
        set("password_hash", bcrypt.hashSync(b.password, 10));
      }
      if (b.brand !== undefined) set("brand", b.brand || null);
      if (b.all_brands !== undefined) set("all_brands", b.all_brands ? 1 : 0);
      if (b.phone !== undefined) set("phone", b.phone || null);
      if (b.is_active !== undefined) set("is_active", b.is_active ? 1 : 0);
      if (b.can_close_override !== undefined)
        set("can_close_override", b.can_close_override ? 1 : 0);
      if (b.default_outlet_code !== undefined)
        set("default_outlet_code", b.default_outlet_code || null);
      // Manual unlock
      if (b.unlock) {
        set("failed_attempts", 0);
        set("locked_until", null);
      }
      if (!updates.length)
        return res.status(400).json({ error: "No fields to update" });
      const r = await db.pRun(
        `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
        [...params, userId],
      );
      if (r.changes === 0)
        return res.status(404).json({ error: "User not found" });

      if (Array.isArray(b.brand_access)) {
        await db.pRun("DELETE FROM user_brand_access WHERE user_id = ?", [
          userId,
        ]);
        for (const bc of b.brand_access)
          await db.pRun(
            "INSERT OR IGNORE INTO user_brand_access (user_id, brand_code) VALUES (?, ?)",
            [userId, bc],
          );
      }
      if (Array.isArray(b.outlet_access)) {
        await db.pRun("DELETE FROM user_outlet_access WHERE user_id = ?", [
          userId,
        ]);
        for (const oc of b.outlet_access)
          await db.pRun(
            "INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)",
            [userId, oc],
          );
      }
      res.json({ id: userId });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update user" });
    }
  },
);

app.delete(
  "/api/users/:id",
  requireAuth,
  requireRole("SuperAdmin"),
  async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId))
      return res.status(400).json({ error: "Invalid user ID" });
    if (userId === req.user.id)
      return res
        .status(400)
        .json({ error: "You cannot delete your own account." });
    const r = await db.pRun("DELETE FROM users WHERE id = ?", [userId]);
    if (r.changes === 0)
      return res.status(404).json({ error: "User not found" });
    res.json({ success: true });
  },
);

// ==========================================================================
// Attachments (preserved robust logic + comment/phase support)
// ==========================================================================
const ALLOWED_MIMES = {
  "image/jpeg": ["ffd8ff"],
  "image/jpg": ["ffd8ff"],
  "image/png": ["89504e47"],
  "image/gif": ["47494638"],
  "image/webp": ["52494646", "57454250"],
  "video/mp4": ["66747970"],
  "video/webm": ["1a45dfa3"],
  "video/quicktime": ["6d6f6f76", "66747970"],
};
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

function checkMagicBytes(filePath, mimeType) {
  const signatures = ALLOWED_MIMES[mimeType];
  if (!signatures) return false;
  try {
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    const fileHex = buffer.toString("hex").toLowerCase();
    return signatures.some((signature) => {
      if (mimeType === "image/webp")
        return (
          fileHex.startsWith("52494646") &&
          fileHex.substring(16, 24) === "57454250"
        );
      if (mimeType === "video/mp4" || mimeType === "video/quicktime")
        return (
          fileHex.substring(8, 16) === "66747970" ||
          fileHex.substring(8, 16) === "6d6f6f76"
        );
      return fileHex.startsWith(signature.toLowerCase());
    });
  } catch (err) {
    console.error("magic bytes:", err);
    return false;
  }
}
function validateFile(filePath, mimeType, size) {
  if (!ALLOWED_MIMES[mimeType]) return "Unsupported file format.";
  const isVideo = mimeType.startsWith("video/");
  if (size > (isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE))
    return `File exceeds maximum size limit of ${isVideo ? "100MB" : "10MB"}.`;
  if (!checkMagicBytes(filePath, mimeType))
    return "File validation failed: signature (magic bytes) mismatch.";
  return null;
}

app.post(
  "/api/attachments/upload",
  requireAuth,
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
        "INSERT INTO attachments (id, ticket_id, file_url, file_name, file_size, mime_type, uploaded_by) VALUES (?, NULL, ?, ?, ?, ?, ?)",
        [fileId, fileUrl, sanitizedName, size, mimetype, req.user.id],
      );
      res
        .status(201)
        .json({
          id: fileId,
          file_url: fileUrl,
          file_name: sanitizedName,
          file_size: size,
          mime_type: mimetype,
        });
    } catch (e) {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      res.status(500).json({ error: e.message });
    }
  },
);

app.post(
  "/api/attachments/upload-chunk",
  requireAuth,
  upload.single("chunk"),
  async (req, res) => {
    const { fileId, chunkIndex, totalChunks, fileName, mimeType, fileSize } =
      req.body;
    if (!req.file)
      return res.status(400).json({ error: "No file chunk received." });
    const idx = parseInt(chunkIndex, 10),
      total = parseInt(totalChunks, 10),
      size = parseInt(fileSize, 10);
    if (
      !fileId ||
      isNaN(idx) ||
      isNaN(total) ||
      !fileName ||
      !mimeType ||
      isNaN(size)
    ) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Missing chunk metadata." });
    }
    if (!ALLOWED_MIMES[mimeType]) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Unsupported file format." });
    }
    const isVideo = mimeType.startsWith("video/");
    if (size > (isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE)) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res
        .status(400)
        .json({ error: "File exceeds maximum size limits." });
    }
    const tempFilePath = path.join(TEMP_DIR, `part_${fileId}`);
    try {
      const chunkData = fs.readFileSync(req.file.path);
      fs.appendFileSync(tempFilePath, chunkData);
      fs.unlinkSync(req.file.path);
    } catch (e) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: "Failed to process chunk." });
    }
    if (idx === total - 1) {
      const err = validateFile(tempFilePath, mimeType, size);
      if (err) {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        return res.status(400).json({ error: err });
      }
      const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const finalPath = path.join(UPLOADS_DIR, fileId);
      try {
        fs.renameSync(tempFilePath, finalPath);
      } catch (e) {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        return res.status(500).json({ error: "Failed to assemble upload." });
      }
      const fileUrl = `/api/attachments/${fileId}`;
      try {
        await db.pRun(
          "INSERT INTO attachments (id, ticket_id, file_url, file_name, file_size, mime_type, uploaded_by) VALUES (?, NULL, ?, ?, ?, ?, ?)",
          [fileId, fileUrl, sanitizedName, size, mimeType, req.user.id],
        );
        res
          .status(201)
          .json({
            id: fileId,
            file_url: fileUrl,
            file_name: sanitizedName,
            file_size: size,
            mime_type: mimeType,
          });
      } catch (e) {
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
        res.status(500).json({ error: e.message });
      }
    } else {
      res.json({ status: "chunk_uploaded", chunkIndex: idx });
    }
  },
);

app.delete("/api/attachments/:id", requireAuth, async (req, res) => {
  const row = await db.pGet("SELECT * FROM attachments WHERE id = ?", [
    req.params.id,
  ]);
  if (!row) return res.status(404).json({ error: "Attachment not found." });
  if (req.user.role === "Requestor" && row.uploaded_by !== req.user.id)
    return res.status(403).json({ error: "Forbidden." });
  await db.pRun("DELETE FROM attachments WHERE id = ?", [req.params.id]);
  const filePath = path.join(UPLOADS_DIR, req.params.id);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.error(e);
    }
  }
  res.json({ success: true });
});

app.get("/api/attachments/:id", requireAuth, async (req, res) => {
  const row = await db.pGet("SELECT * FROM attachments WHERE id = ?", [
    req.params.id,
  ]);
  if (!row)
    return res.status(404).json({ error: "Attachment reference not found." });
  const sendFileResponse = () => {
    const filePath = path.join(UPLOADS_DIR, req.params.id);
    if (!fs.existsSync(filePath))
      return res.status(404).json({ error: "File not found on server disk." });
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    );
    res.sendFile(filePath);
  };
  // Admins/SuperAdmin: department-scoped access via the ticket.
  if (row.ticket_id) {
    const ticket = await getVisibleTicket(req.user, row.ticket_id);
    if (!ticket) return res.status(403).json({ error: "Forbidden." });
    return sendFileResponse();
  }
  // Unlinked upload — only the uploader may fetch it.
  if (row.uploaded_by !== req.user.id && !isAdmin(req.user))
    return res.status(403).json({ error: "Forbidden." });
  sendFileResponse();
});

// --- Orphaned temp upload cleanup (hourly) ---------------------------------
function cleanupOrphans() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(TEMP_DIR)) {
      const p = path.join(TEMP_DIR, f);
      try {
        if (now - fs.statSync(p).mtimeMs > 6 * 60 * 60 * 1000) fs.unlinkSync(p);
      } catch (_) {}
    }
  } catch (_) {}
}
setInterval(cleanupOrphans, 60 * 60 * 1000);

// --- Static + SPA ----------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong on the server!" });
});

// --- Start (after DB is ready) ---------------------------------------------
db.ready.then(() => {
  app.listen(PORT, () => {
    console.log(`IT-ME Ticketing server running at http://localhost:${PORT}`);
  });
});

module.exports = app;
