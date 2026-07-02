const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'tickets.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

db.all('SELECT id, username, email, password_hash, role FROM users', [], (err, rows) => {
  if (err) {
    console.error('Error querying users:', err.message);
  } else {
    console.log(JSON.stringify(rows, null, 2));
  }
  db.close();
});
