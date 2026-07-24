/* Dev-only inspection helper. Never exposes password hashes.
   Refuses to run when NODE_ENV=production. */
if (process.env.NODE_ENV === 'production') {
  console.error('query-users.js is disabled in production.');
  process.exit(1);
}

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.resolve(__dirname, 'tickets.db'), (err) => {
  if (err) { console.error('Error opening database:', err.message); process.exit(1); }
});

db.all(
  `SELECT id, username, email, role, department, brand, all_brands, is_active,
          CASE WHEN locked_until IS NOT NULL AND locked_until > CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS locked
     FROM users ORDER BY id`,
  [],
  (err, rows) => {
    if (err) console.error('Error querying users:', err.message);
    else console.table(rows);
    db.close();
  }
);
