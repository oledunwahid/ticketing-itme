const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const db = new sqlite3.Database(path.resolve(__dirname, '../tickets.db'), (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

db.all('SELECT id, username, email, password_hash, role, department, brand, all_brands, is_active FROM users ORDER BY id', [], (err, rows) => {
  if (err) {
    console.error('Error querying users:', err.message);
    process.exit(1);
  }

  const headers = ['id', 'username', 'email', 'password_hash', 'role', 'department', 'brand', 'all_brands', 'is_active'];
  const csvLines = [headers.join(',')];

  rows.forEach(r => {
    const row = headers.map(h => {
      const val = r[h] === null || r[h] === undefined ? '' : String(r[h]);
      return '"' + val.replace(/"/g, '""') + '"';
    });
    csvLines.push(row.join(','));
  });

  const csvContent = csvLines.join('\n');
  const outputPath = path.resolve(__dirname, '../users_with_hashes.csv');
  fs.writeFileSync(outputPath, csvContent, 'utf-8');
  console.log(`Successfully generated users_with_hashes.csv with ${rows.length} user records at: ${outputPath}`);
  db.close();
});
