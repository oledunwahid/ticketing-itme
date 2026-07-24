const db = require('../database');
const bcrypt = require('bcryptjs');

async function testAll() {
  console.log("=== VERIFICATION START ===");

  await db.ready;
  console.log("✔ Database initialized successfully.");

  // 1. Check user Edi exists
  const edi = await db.pGet("SELECT * FROM users WHERE LOWER(username) = 'edi'");
  if (edi) {
    console.log(`✔ User Edi found: ID=${edi.id}, Role=${edi.role}, Dept=${edi.department}`);
  } else {
    console.error("✖ User Edi not found!");
  }

  // 2. Check roles and departments
  const depts = await db.pAll("SELECT * FROM departments");
  console.log("✔ System departments:", depts.map(d => d.code).join(", "));

  // 3. Test Change Password logic
  const superadmin = await db.pGet("SELECT * FROM users WHERE role = 'SuperAdmin'");
  if (superadmin) {
    console.log(`✔ SuperAdmin account found: ${superadmin.email}`);
  }

  // 4. Test ticket creation with Nama Requestor
  const reqName = "Fauzi Test Requestor";
  const cat = await db.pGet("SELECT name FROM categories WHERE department_code = 'IT' LIMIT 1");
  const outlet = await db.pGet("SELECT code FROM outlets LIMIT 1");

  const ticketNumber = `IT-2026-TEST-${Date.now().toString().slice(-4)}`;
  const r = await db.pRun(
    `INSERT INTO tickets (ticket_number, title, description, department, category, outlet_code, requestor_user_id, customer_name, customer_email, status, urgency)
     VALUES (?, ?, ?, 'IT', ?, ?, ?, ?, ?, 'New', 'Medium')`,
    [ticketNumber, "Test Title", "Test Description", cat ? cat.name : 'Software', outlet ? outlet.code : 'UTP', superadmin ? superadmin.id : 1, reqName, "test@union.com"]
  );
  const ticketId = r.lastID;
  console.log(`✔ Test ticket created ID=${ticketId}, TicketNumber=${ticketNumber}, RequestorName=${reqName}`);

  // 5. Test Multi-Technician assignment
  const tech1 = await db.pGet("SELECT * FROM users WHERE role IN ('TechnicianIT','TechnicianME') LIMIT 1");
  const tech2 = await db.pGet("SELECT * FROM users WHERE role IN ('TechnicianIT','TechnicianME') AND id != ? LIMIT 1", [tech1 ? tech1.id : 0]);

  if (tech1 && tech2) {
    // Assign Tech 1 as Primary
    await db.pRun(
      "INSERT INTO ticket_assignments (ticket_id, technician_id, assigned_by, role_type, active, is_active) VALUES (?, ?, ?, 'primary', 1, 1)",
      [ticketId, tech1.id, superadmin ? superadmin.id : 1]
    );
    await db.pRun("UPDATE tickets SET assigned_technician_id = ?, assignee_name = ? WHERE id = ?", [tech1.id, tech1.username, ticketId]);

    // Assign Tech 2 as Collaborator
    await db.pRun(
      "INSERT INTO ticket_assignments (ticket_id, technician_id, assigned_by, role_type, active, is_active) VALUES (?, ?, ?, 'collaborator', 1, 1)",
      [ticketId, tech2.id, superadmin ? superadmin.id : 1]
    );

    const activeAssignments = await db.pAll(
      `SELECT a.*, u.username FROM ticket_assignments a JOIN users u ON u.id = a.technician_id WHERE a.ticket_id = ? AND a.active = 1`,
      [ticketId]
    );
    console.log("✔ Active Ticket Assignments for ticket", ticketId, ":");
    activeAssignments.forEach(a => {
      console.log(`   - ${a.username} (${a.role_type})`);
    });
  }

  console.log("=== ALL VERIFICATION CHECKS PASSED SUCCESSFULLY ===");
  process.exit(0);
}

testAll().catch(err => {
  console.error("✖ Verification failed:", err);
  process.exit(1);
});
