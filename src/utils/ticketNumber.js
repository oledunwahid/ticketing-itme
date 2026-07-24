/* ==========================================================================
   Util — ticket number generator
   Verbatim move of nextTicketNumber() from app.js. Behavior unchanged:
   atomically bumps ticket_counters for (department, current year) and returns
   a number formatted as "DEPT-YYYY-NNNN" (sequence zero-padded to 4 digits).
   ========================================================================== */
const db = require("../../database");

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

module.exports = { nextTicketNumber };
