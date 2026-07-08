/* ==========================================================================
   IT-ME Ticketing — Database Layer
   Node.js + SQLite (sqlite3). Additive, data-preserving migrations.
   ========================================================================== */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(__dirname, 'tickets.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// --- Promisified helpers ---------------------------------------------------
const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (e) {
      if (e) reject(e);
      else resolve(this);
    });
  });
const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (e, row) => (e ? reject(e) : resolve(row)));
  });
const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows)));
  });
const exec = (sql) =>
  new Promise((resolve, reject) => {
    db.exec(sql, (e) => (e ? reject(e) : resolve()));
  });

// Expose promise helpers to the rest of the app.
db.pAll = all;
db.pGet = get;
db.pRun = run;
db.pExec = exec;

// --- Reference data --------------------------------------------------------
const BRANDS = [
  { code: 'UNION', name: 'Union' },
  { code: 'CNS', name: 'CNS' },
  { code: 'FRENCH', name: 'French' },
  { code: 'IBR', name: 'IBR' },
  { code: 'IND', name: 'Independent' },
];

// display_label lets us collapse MILGI/MILPIK → MILBISPIK on reports without
// mutating raw ticket storage. Default display_label = code.
const OUTLETS = [
  // UNION
  ['UTP', 'UNION'], ['UPKW', 'UNION'], ['UPS', 'UNION'], ['USC', 'UNION'],
  ['UCP', 'UNION'], ['UGI', 'UNION'], ['UPIM', 'UNION'], ['UPIK', 'UNION'],
  ['UMKG', 'UNION'], ['USMS', 'UNION'], ['UMPI', 'UNION'],
  // CNS
  ['CSPI', 'CNS'], ['CSPP', 'CNS'], ['CSSG', 'CNS'], ['BLCS', 'CNS'],
  // FRENCH
  ['LWY-OAK', 'FRENCH'], ['BAB-SEN', 'FRENCH'], ['PIE-SNPT', 'FRENCH'],
  // IBR
  ['ROMSCBD', 'IBR'], ['ROMPIM', 'IBR'], ['BISSCBD', 'IBR'], ['BISPIK', 'IBR'],
  ['MILGI', 'IBR', 'MILBISPIK'], ['MILPIK', 'IBR', 'MILBISPIK'],
  // IND
  ['IND1', 'IND'],
];

const DEPARTMENTS = [
  { code: 'IT', name: 'Information Technology' },
  { code: 'ME', name: 'Mechanical Engineering' },
];

const CATEGORIES = {
  IT: [
    'POS System', 'Printer', 'Network / Internet', 'WiFi', 'CCTV',
    'EDC / Payment Device', 'Computer / Laptop', 'Email / Account',
    'Software', 'Hardware', 'Other IT',
  ],
  ME: [
    'AC', 'Electrical', 'Plumbing', 'Kitchen Equipment', 'Building / Facility',
    'Furniture / Fixture', 'Lighting', 'Exhaust / Ventilation', 'Gas / Utility',
    'Other Maintenance',
  ],
};

// New role set (old Agent→SuperAdmin, old Customer→Requestor on migration).
const APP_ROLES = [
  'Requestor', 'SuperAdmin', 'AdminIT', 'AdminME',
  'TechnicianIT', 'TechnicianME', 'Leader',
];

// --- Migration runner ------------------------------------------------------
async function applied(name) {
  const row = await get('SELECT 1 FROM schema_migrations WHERE name = ?', [name]);
  return !!row;
}
async function markApplied(name) {
  await run('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
}
async function migrate(name, fn) {
  if (await applied(name)) return;
  console.log(`  ↳ applying migration: ${name}`);
  await fn();
  await markApplied(name);
}

// column-exists guard for additive ALTERs
async function hasColumn(table, column) {
  const cols = await all(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}
async function addColumn(table, column, definition) {
  if (!(await hasColumn(table, column))) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// --- Base tables (fresh install path) --------------------------------------
async function createBaseTables() {
  await exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Requestor',
      brand TEXT,
      failed_attempts INTEGER DEFAULT 0,
      locked_until DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'New',
      priority TEXT DEFAULT 'Low',
      customer_name TEXT,
      customer_email TEXT,
      assignee_name TEXT DEFAULT 'Unassigned',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      author_role TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      ticket_id INTEGER,
      file_url TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

// --- Migrations ------------------------------------------------------------
async function runMigrations() {
  // m001 — reference + operational tables
  await migrate('m001_reference_and_ops_tables', async () => {
    await exec(`
      CREATE TABLE IF NOT EXISTS brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        active INTEGER DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS outlets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        brand_code TEXT NOT NULL,
        display_label TEXT,
        active INTEGER DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        department_code TEXT NOT NULL,
        name TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        UNIQUE(department_code, name)
      );
      CREATE TABLE IF NOT EXISTS ticket_counters (
        department_code TEXT NOT NULL,
        year INTEGER NOT NULL,
        last_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (department_code, year)
      );
      CREATE TABLE IF NOT EXISTS ticket_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        technician_id INTEGER,
        assigned_by INTEGER,
        reason TEXT,
        active INTEGER DEFAULT 1,
        assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        unassigned_at DATETIME,
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ticket_activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        actor_user_id INTEGER,
        actor_name TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        detail TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS technician_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL,      -- 0=Sun .. 6=Sat
        start_time TEXT NOT NULL,          -- 'HH:MM'
        end_time TEXT NOT NULL,            -- 'HH:MM'
        active INTEGER DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS technician_unavailability (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        start_datetime DATETIME NOT NULL,
        end_datetime DATETIME NOT NULL,
        reason TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS technician_skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        department_code TEXT,
        category_name TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_brand_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        brand_code TEXT NOT NULL,
        UNIQUE(user_id, brand_code),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_outlet_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        outlet_code TEXT NOT NULL,
        UNIQUE(user_id, outlet_code),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS notification_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER,
        channel TEXT NOT NULL,             -- in_app | email | whatsapp
        recipient TEXT,
        template TEXT,
        payload TEXT,
        status TEXT DEFAULT 'queued',      -- queued | sent | skipped | failed
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sla_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enabled INTEGER DEFAULT 0,
        department_code TEXT,
        urgency TEXT,
        category_name TEXT,
        first_response_mins INTEGER,
        resolution_mins INTEGER,
        active INTEGER DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  });

  // m002 — expand users (relax role CHECK, add operational columns)
  await migrate('m002_expand_users', async () => {
    await run('PRAGMA foreign_keys = OFF');
    await exec('BEGIN TRANSACTION');
    try {
      await exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'Requestor',
          department TEXT,
          brand TEXT,
          all_brands INTEGER DEFAULT 0,
          phone TEXT,
          is_active INTEGER DEFAULT 1,
          can_close_override INTEGER DEFAULT 0,
          default_outlet_code TEXT,
          failed_attempts INTEGER DEFAULT 0,
          locked_until DATETIME DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users_new
          (id, username, email, password_hash, role, department, brand, all_brands,
           is_active, failed_attempts, locked_until, created_at)
        SELECT
          id, username, email, password_hash,
          CASE role WHEN 'Agent' THEN 'SuperAdmin' WHEN 'Customer' THEN 'Requestor' ELSE 'Requestor' END,
          NULL,
          brand,
          CASE role WHEN 'Agent' THEN 1 ELSE 0 END,
          1,
          COALESCE(failed_attempts, 0),
          locked_until,
          created_at
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      await exec('COMMIT');
    } catch (e) {
      await exec('ROLLBACK');
      throw e;
    } finally {
      await run('PRAGMA foreign_keys = ON');
    }
  });

  // m003 — expand tickets (operational columns + SLA timestamps)
  await migrate('m003_expand_tickets', async () => {
    await addColumn('tickets', 'ticket_number', 'TEXT');
    await addColumn('tickets', 'department', 'TEXT');
    await addColumn('tickets', 'category', 'TEXT');
    await addColumn('tickets', 'outlet_code', 'TEXT');
    await addColumn('tickets', 'brand_code', 'TEXT');
    await addColumn('tickets', 'urgency', "TEXT DEFAULT 'Medium'");
    await addColumn('tickets', 'report_mode', "TEXT DEFAULT 'quick'");
    await addColumn('tickets', 'requestor_user_id', 'INTEGER');
    await addColumn('tickets', 'contact_person', 'TEXT');
    await addColumn('tickets', 'contact_number', 'TEXT');
    await addColumn('tickets', 'location_detail', 'TEXT');
    await addColumn('tickets', 'device_equipment', 'TEXT');
    await addColumn('tickets', 'business_impact', 'TEXT');
    await addColumn('tickets', 'preferred_visit_time', 'TEXT');
    await addColumn('tickets', 'occurrence_at', 'DATETIME');
    await addColumn('tickets', 'assigned_technician_id', 'INTEGER');
    await addColumn('tickets', 'resolution_note', 'TEXT');
    await addColumn('tickets', 'cancel_reason', 'TEXT');
    await addColumn('tickets', 'estimated_cost', 'REAL');
    await addColumn('tickets', 'sparepart_note', 'TEXT');
    await addColumn('tickets', 'expected_part_date', 'DATETIME');
    await addColumn('tickets', 'vendor_note', 'TEXT');
    await addColumn('tickets', 'first_response_at', 'DATETIME');
    await addColumn('tickets', 'assigned_at', 'DATETIME');
    await addColumn('tickets', 'started_at', 'DATETIME');
    await addColumn('tickets', 'resolved_at', 'DATETIME');
    await addColumn('tickets', 'closed_at', 'DATETIME');
    // unique index on ticket_number (allows multiple NULLs in SQLite)
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_number ON tickets(ticket_number)');
    await run('CREATE INDEX IF NOT EXISTS idx_tickets_department ON tickets(department)');
    await run('CREATE INDEX IF NOT EXISTS idx_tickets_brand ON tickets(brand_code)');
    await run('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)');
  });

  // m004 — attachments can attach to comments + before/after phase
  await migrate('m004_attachments_comment_phase', async () => {
    await addColumn('attachments', 'comment_id', 'INTEGER');
    await addColumn('attachments', 'phase', "TEXT DEFAULT 'general'"); // general|before|after
  });

  // m005 — comments: separate system logs from human comments
  await migrate('m005_comments_is_system', async () => {
    await addColumn('comments', 'is_system', 'INTEGER DEFAULT 0');
    await addColumn('comments', 'author_user_id', 'INTEGER');
  });

  // m006 — seed reference data (idempotent)
  await migrate('m006_seed_reference', async () => {
    for (const b of BRANDS) {
      await run('INSERT OR IGNORE INTO brands (code, name) VALUES (?, ?)', [b.code, b.name]);
    }
    for (const o of OUTLETS) {
      const [code, brand, display] = o;
      await run(
        'INSERT OR IGNORE INTO outlets (code, name, brand_code, display_label) VALUES (?, ?, ?, ?)',
        [code, code, brand, display || code]
      );
    }
    for (const d of DEPARTMENTS) {
      await run('INSERT OR IGNORE INTO departments (code, name) VALUES (?, ?)', [d.code, d.name]);
    }
    for (const [dept, list] of Object.entries(CATEGORIES)) {
      let order = 0;
      for (const name of list) {
        await run(
          'INSERT OR IGNORE INTO categories (department_code, name, sort_order) VALUES (?, ?, ?)',
          [dept, name, order++]
        );
      }
    }
    // Default (disabled) SLA row so the settings module has something to show.
    await run(
      'INSERT INTO sla_settings (enabled, department_code, urgency, first_response_mins, resolution_mins) VALUES (0, NULL, NULL, 60, 480)'
    );
  });

  // m008 — relax the legacy CHECK constraints on tickets.status / tickets.priority
  await migrate('m008_relax_ticket_constraints', async () => {
    await run('PRAGMA foreign_keys = OFF');
    await exec('BEGIN TRANSACTION');
    try {
      await exec(`
        CREATE TABLE tickets_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_number TEXT,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'New',
          priority TEXT,
          urgency TEXT DEFAULT 'Medium',
          department TEXT,
          category TEXT,
          outlet_code TEXT,
          brand_code TEXT,
          report_mode TEXT DEFAULT 'quick',
          requestor_user_id INTEGER,
          customer_name TEXT,
          customer_email TEXT,
          contact_person TEXT,
          contact_number TEXT,
          location_detail TEXT,
          device_equipment TEXT,
          business_impact TEXT,
          preferred_visit_time TEXT,
          occurrence_at DATETIME,
          assignee_name TEXT DEFAULT 'Unassigned',
          assigned_technician_id INTEGER,
          resolution_note TEXT,
          cancel_reason TEXT,
          estimated_cost REAL,
          sparepart_note TEXT,
          expected_part_date DATETIME,
          vendor_note TEXT,
          first_response_at DATETIME,
          assigned_at DATETIME,
          started_at DATETIME,
          resolved_at DATETIME,
          closed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO tickets_new
          (id, ticket_number, title, description, status, priority, urgency, department, category,
           outlet_code, brand_code, report_mode, requestor_user_id, customer_name, customer_email,
           contact_person, contact_number, location_detail, device_equipment, business_impact,
           preferred_visit_time, occurrence_at, assignee_name, assigned_technician_id, resolution_note,
           cancel_reason, estimated_cost, sparepart_note, expected_part_date, vendor_note,
           first_response_at, assigned_at, started_at, resolved_at, closed_at, created_at, updated_at)
        SELECT
           id, ticket_number, title, description, status, priority, urgency, department, category,
           outlet_code, brand_code, report_mode, requestor_user_id, customer_name, customer_email,
           contact_person, contact_number, location_detail, device_equipment, business_impact,
           preferred_visit_time, occurrence_at, assignee_name, assigned_technician_id, resolution_note,
           cancel_reason, estimated_cost, sparepart_note, expected_part_date, vendor_note,
           first_response_at, assigned_at, started_at, resolved_at, closed_at, created_at, updated_at
        FROM tickets;
        DROP TABLE tickets;
        ALTER TABLE tickets_new RENAME TO tickets;
      `);
      await exec('COMMIT');
    } catch (e) { await exec('ROLLBACK'); throw e; }
    finally { await run('PRAGMA foreign_keys = ON'); }
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_number ON tickets(ticket_number)');
    await run('CREATE INDEX IF NOT EXISTS idx_tickets_department ON tickets(department)');
    await run('CREATE INDEX IF NOT EXISTS idx_tickets_brand ON tickets(brand_code)');
    await run('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)');
  });

  // m009 — relax the legacy CHECK constraint on comments.author_role
  await migrate('m009_relax_comment_constraints', async () => {
    await run('PRAGMA foreign_keys = OFF');
    await exec('BEGIN TRANSACTION');
    try {
      await exec(`
        CREATE TABLE comments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id INTEGER NOT NULL,
          author_name TEXT NOT NULL,
          author_role TEXT,
          author_user_id INTEGER,
          message TEXT NOT NULL,
          is_system INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
        );
        INSERT INTO comments_new (id, ticket_id, author_name, author_role, author_user_id, message, is_system, created_at)
        SELECT id, ticket_id, author_name, author_role, author_user_id, message, COALESCE(is_system,0), created_at FROM comments;
        DROP TABLE comments;
        ALTER TABLE comments_new RENAME TO comments;
      `);
      await exec('COMMIT');
    } catch (e) { await exec('ROLLBACK'); throw e; }
    finally { await run('PRAGMA foreign_keys = ON'); }
  });

  // m007 — backfill legacy tickets into the new model + ticket numbers
  await migrate('m007_backfill_tickets', async () => {
    const legacy = await all(
      'SELECT id, priority, created_at FROM tickets WHERE ticket_number IS NULL ORDER BY id ASC'
    );
    for (const t of legacy) {
      const year = new Date(t.created_at || Date.now()).getFullYear();
      // atomic-ish counter bump (single-threaded migration)
      await run(
        `INSERT INTO ticket_counters (department_code, year, last_seq) VALUES ('IT', ?, 1)
         ON CONFLICT(department_code, year) DO UPDATE SET last_seq = last_seq + 1`,
        [year]
      );
      const row = await get(
        'SELECT last_seq FROM ticket_counters WHERE department_code = ? AND year = ?',
        ['IT', year]
      );
      const number = `IT-${year}-${String(row.last_seq).padStart(4, '0')}`;
      const urgency =
        t.priority === 'Urgent' ? 'Critical'
          : t.priority === 'High' ? 'High'
          : t.priority === 'Medium' ? 'Medium'
          : 'Low';
      await run(
        `UPDATE tickets
           SET ticket_number = ?, department = 'IT', category = 'Other IT',
               urgency = ?, report_mode = 'detailed'
         WHERE id = ?`,
        [number, urgency, t.id]
      );
    }
  });

  // m010 — Region (outlets/tickets/users) + technician PIC & scheduled fields.
  // All additive & data-preserving. Existing outlets/tickets default to Jakarta;
  // UTP and UPKW move to Surabaya as requested.
  await migrate('m010_region_scheduled_pic', async () => {
    // Outlets: region column, default Jakarta
    await addColumn('outlets', 'region', "TEXT DEFAULT 'Jakarta'");
    await run("UPDATE outlets SET region = 'Jakarta' WHERE region IS NULL OR region = ''");
    await run("UPDATE outlets SET region = 'Surabaya' WHERE code IN ('UTP','UPKW')");

    // Tickets: region (inferred from outlet) + scheduled window for On Scheduled/Event
    await addColumn('tickets', 'region', 'TEXT');
    await addColumn('tickets', 'scheduled_at', 'DATETIME');
    await addColumn('tickets', 'scheduled_end', 'DATETIME');
    await run(
      `UPDATE tickets SET region = (
         SELECT o.region FROM outlets o WHERE o.code = tickets.outlet_code
       ) WHERE region IS NULL`
    );

    // Users: broader outlet access flag + region + PIC area label (technician scope)
    await addColumn('users', 'all_outlets', 'INTEGER DEFAULT 0');
    await addColumn('users', 'region', 'TEXT');
    await addColumn('users', 'pic_area', 'TEXT');

    await run('CREATE INDEX IF NOT EXISTS idx_tickets_region ON tickets(region)');
    await run('CREATE INDEX IF NOT EXISTS idx_outlets_region ON outlets(region)');
  });

  // m011 — Seed demo technician PIC outlet coverage (mirrors the PDF PIC/area
  // schedule concept). Idempotent; only assigns outlets that exist. Does not
  // grant all_outlets, so admins can still widen scope per-technician.
  await migrate('m011_seed_technician_pic', async () => {
    const picMap = {
      'techit1@union.com': ['UPS', 'USC', 'UCP'],       // IT PIC — Area 1
      'techit2@union.com': ['UGI', 'UPIM', 'UPIK'],     // IT PIC — Area 2
      'techme1@union.com': ['UMKG', 'USMS', 'UMPI'],    // ME PIC — Area 1
      'techme2@union.com': ['UTP', 'UPKW'],             // ME PIC — Surabaya
    };
    for (const [email, outlets] of Object.entries(picMap)) {
      const u = await get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email]);
      if (!u) continue;
      const area = email.includes('me') ? 'ME Area' : 'IT Area';
      await run('UPDATE users SET pic_area = COALESCE(pic_area, ?) WHERE id = ?', [area, u.id]);
      for (const oc of outlets) {
        const o = await get('SELECT 1 FROM outlets WHERE code = ?', [oc]);
        if (!o) continue;
        await run(
          'INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)',
          [u.id, oc]
        );
      }
    }
  });

  // m012 — Event category (for scheduled / On Scheduled tickets) in both depts.
  await migrate('m012_event_category', async () => {
    await run(
      "INSERT OR IGNORE INTO categories (department_code, name, sort_order) VALUES ('IT','Event',50)"
    );
    await run(
      "INSERT OR IGNORE INTO categories (department_code, name, sort_order) VALUES ('ME','Event',50)"
    );
  });

  // m013 — Give every technician that has no PIC outlet coverage yet a small
  // default coverage set, so the "default to my PIC outlets" behaviour is
  // demonstrable on real accounts. Fully editable later via the user modal.
  await migrate('m013_default_pic_for_technicians', async () => {
    const techs = await all(
      "SELECT id, email FROM users WHERE role IN ('TechnicianIT','TechnicianME')"
    );
    const pool = (await all("SELECT code FROM outlets WHERE active = 1 ORDER BY code")).map((r) => r.code);
    if (!pool.length) return;
    let cursor = 0;
    for (const t of techs) {
      const existing = await get(
        'SELECT COUNT(*) c FROM user_outlet_access WHERE user_id = ?',
        [t.id]
      );
      if (existing.c > 0) continue; // respect any manual configuration
      const picks = [];
      for (let i = 0; i < 3 && pool.length; i++) {
        picks.push(pool[cursor % pool.length]);
        cursor++;
      }
      for (const oc of picks) {
        await run(
          'INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)',
          [t.id, oc]
        );
      }
      await run("UPDATE users SET pic_area = COALESCE(pic_area, 'PIC Area') WHERE id = ?", [t.id]);
    }
  });

  // m014 — Public Quick Report support. Additive & data-preserving:
  //   • tickets.source                    'authenticated' | 'public_quick_report'
  //   • tickets.public_reporter_name      reporter name for login-less tickets
  //   • tickets.public_reporter_contact   reporter WhatsApp/phone
  //   • tickets.tracking_token_hash       sha256 of the (unstored) tracking token
  //   • tickets.tracking_token_created_at when the token was issued
  // Existing tickets are backfilled to source='authenticated'.
  await migrate('m014_public_quick_report', async () => {
    await addColumn('tickets', 'source', "TEXT DEFAULT 'authenticated'");
    await addColumn('tickets', 'public_reporter_name', 'TEXT');
    await addColumn('tickets', 'public_reporter_contact', 'TEXT');
    await addColumn('tickets', 'tracking_token_hash', 'TEXT');
    await addColumn('tickets', 'tracking_token_created_at', 'DATETIME');
    await run("UPDATE tickets SET source = 'authenticated' WHERE source IS NULL OR source = ''");
    await run('CREATE INDEX IF NOT EXISTS idx_tickets_source ON tickets(source)');
    await run('CREATE INDEX IF NOT EXISTS idx_tickets_track ON tickets(tracking_token_hash)');
  });
}

// --- Demo seed (fresh installs only) --------------------------------------
async function seedIfEmpty() {
  const row = await get('SELECT COUNT(*) AS count FROM users');
  if (row.count > 0) return;
  console.log('Seeding IT-ME demo data (fresh install)...');

  const pw = bcrypt.hashSync('Password123!', 10);
  const users = [
    // username, email, role, department, all_brands, brand
    ['Super Admin', 'superadmin@union.com', 'SuperAdmin', null, 1, null],
    ['Admin IT', 'adminit@union.com', 'AdminIT', 'IT', 1, null],
    ['Admin ME', 'adminme@union.com', 'AdminME', 'ME', 1, null],
    ['Budi (IT Tech)', 'techit1@union.com', 'TechnicianIT', 'IT', 1, null],
    ['Andi (IT Tech)', 'techit2@union.com', 'TechnicianIT', 'IT', 1, null],
    ['Slamet (ME Tech)', 'techme1@union.com', 'TechnicianME', 'ME', 1, null],
    ['Joko (ME Tech)', 'techme2@union.com', 'TechnicianME', 'ME', 1, null],
    ['Operations Leader', 'leader@union.com', 'Leader', null, 1, null],
    ['UTP Outlet', 'requestor@union.com', 'Requestor', null, 0, 'UNION'],
  ];
  const ids = {};
  for (const [username, email, role, dept, allBrands, brand] of users) {
    const r = await run(
      `INSERT INTO users (username, email, password_hash, role, department, all_brands, brand, default_outlet_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, email, pw, role, dept, allBrands, brand, email.startsWith('requestor') ? 'UTP' : null]
    );
    ids[email] = r.lastID;
  }

  // Requestor scoped to UNION brand + UTP outlet
  await run('INSERT OR IGNORE INTO user_brand_access (user_id, brand_code) VALUES (?, ?)', [ids['requestor@union.com'], 'UNION']);
  await run('INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)', [ids['requestor@union.com'], 'UTP']);

  // Technician Mon–Fri 09:00–18:00 schedules
  for (const email of ['techit1@union.com', 'techit2@union.com', 'techme1@union.com', 'techme2@union.com']) {
    for (let d = 1; d <= 5; d++) {
      await run(
        'INSERT INTO technician_schedules (user_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)',
        [ids[email], d, '09:00', '18:00']
      );
    }
  }
  // A couple of skills
  await run('INSERT INTO technician_skills (user_id, department_code, category_name) VALUES (?, ?, ?)', [ids['techit1@union.com'], 'IT', 'POS System']);
  await run('INSERT INTO technician_skills (user_id, department_code, category_name) VALUES (?, ?, ?)', [ids['techme1@union.com'], 'ME', 'AC']);
}

// --- Init orchestration ----------------------------------------------------
async function initDatabase() {
  await run('PRAGMA foreign_keys = ON');
  await createBaseTables();
  await runMigrations();
  await seedIfEmpty();
  console.log('Database ready:', dbPath);
}

const ready = initDatabase().catch((err) => {
  console.error('FATAL: database initialization failed:', err);
  process.exit(1);
});

db.ready = ready; // app.js can await db.ready before listening
db.APP_ROLES = APP_ROLES;

module.exports = db;
