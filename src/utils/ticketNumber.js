/* ==========================================================================
   Util — ticket number generator
   Atomically bumps ticket_counters for (department, current year) and returns
   "DEPT-YYYY-NNNN". The upsert and the read are ONE statement (RETURNING), so
   two tickets created at the same moment can never receive the same number.
   ========================================================================== */
const db = require("../../database");

async function nextTicketNumber(department) {
  const year = new Date().getFullYear();
  const row = await db.pGet(
    `INSERT INTO ticket_counters (department_code, year, last_seq) VALUES (?, ?, 1)
     ON CONFLICT(department_code, year) DO UPDATE SET last_seq = last_seq + 1
     RETURNING last_seq`,
    [department, year],
  );
  return `${department}-${year}-${String(row.last_seq).padStart(4, "0")}`;
}

// Insert with a fresh number, retrying if the counter ever lags behind
// existing data (e.g. after a restore). `insert(number)` performs the INSERT.
async function insertWithNumber(department, insert) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextTicketNumber(department);
    try {
      return { number, result: await insert(number) };
    } catch (e) {
      if (!/UNIQUE constraint failed: tickets\.ticket_number/.test(e.message)) throw e;
    }
  }
  throw new Error("Could not allocate a ticket number");
}

module.exports = { nextTicketNumber, insertWithNumber };
