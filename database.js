const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(__dirname, 'tickets.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database at:', dbPath);
    db.run("PRAGMA foreign_keys = ON", (pragmaErr) => {
      if (pragmaErr) console.error("Error enabling foreign keys:", pragmaErr.message);
    });
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    // Create users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT CHECK( role IN ('Customer', 'Agent') ) DEFAULT 'Customer',
        brand TEXT CHECK( brand IN ('UNION', 'IBR', 'FRENCH', 'CORK', 'GROUP') ) DEFAULT NULL,
        failed_attempts INTEGER DEFAULT 0,
        locked_until DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (!err) {
        db.run("ALTER TABLE users ADD COLUMN brand TEXT CHECK( brand IN ('UNION', 'IBR', 'FRENCH', 'CORK', 'GROUP') ) DEFAULT NULL", (alterErr) => {
          // Ignore error if column already exists
        });
      }
    });

    // Create tickets table
    db.run(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT CHECK( status IN ('New', 'Open', 'Pending', 'Solved', 'Closed') ) DEFAULT 'New',
        priority TEXT CHECK( priority IN ('Low', 'Medium', 'High', 'Urgent') ) DEFAULT 'Low',
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        assignee_name TEXT DEFAULT 'Unassigned',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create comments table
    db.run(`
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        author_name TEXT NOT NULL,
        author_role TEXT CHECK( author_role IN ('Customer', 'Agent') ) NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      )
    `);

    // Create attachments table with uploaded_by referencing users
    db.run(`
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
      )
    `);

    // Check if we need to seed the tables
    db.get('SELECT COUNT(*) AS count FROM users', (err, row) => {
      if (err) {
        console.error('Error checking users count:', err.message);
        return;
      }

      if (row.count === 0) {
        console.log('Seeding initial Zendesk-inspired demonstration data...');
        seedData();
      }
    });
  });
}

function seedData() {
  const defaultPasswordHash = bcrypt.hashSync('Password123!', 10);
  
  const seedUsers = [
    { username: 'Agent Admin', email: 'agent@omnidesk.com', password_hash: defaultPasswordHash, role: 'Agent' },
    { username: 'John Doe', email: 'john.doe@example.com', password_hash: defaultPasswordHash, role: 'Customer' },
    { username: 'Alice Smith', email: 'alice.smith@techcorp.io', password_hash: defaultPasswordHash, role: 'Customer' },
    { username: 'Michael Scott', email: 'michael.scott@dundermifflin.com', password_hash: defaultPasswordHash, role: 'Customer' },
    { username: 'Pam Beesly', email: 'pam@dundermifflin.com', password_hash: defaultPasswordHash, role: 'Customer' }
  ];

  const userStmt = db.prepare(`
    INSERT INTO users (username, email, password_hash, role)
    VALUES (?, ?, ?, ?)
  `);

  seedUsers.forEach(u => {
    userStmt.run(u.username, u.email, u.password_hash, u.role, (err) => {
      if (err) console.error('Error seeding user:', err.message);
    });
  });
  userStmt.finalize();

  const initialTickets = [
    {
      title: 'Unable to access dashboard after password reset',
      description: 'Hi support, I reset my password today but when I try to log in, the dashboard page keeps showing a 403 Forbidden error. I already cleared my browser cache but the issue persists. Please help!',
      status: 'Open',
      priority: 'High',
      customer_name: 'John Doe',
      customer_email: 'john.doe@example.com',
      assignee_name: 'Sarah Connor (Agent)'
    },
    {
      title: 'Inquiry regarding API limits for Enterprise plan',
      description: 'Hello, our company is building an integration and we need to know the exact rate limits for the Enterprise REST APIs. Also, do you support webhook retry policies?',
      status: 'Pending',
      priority: 'Medium',
      customer_name: 'Alice Smith',
      customer_email: 'alice.smith@techcorp.io',
      assignee_name: 'Dave Miller (API Support)'
    },
    {
      title: 'URGENT: Production database connection failing intermittently',
      description: 'We are seeing frequent database connection timeouts in our production environment. This is affecting our end users. Need immediate assistance from the infrastructure team.',
      status: 'New',
      priority: 'Urgent',
      customer_name: 'Michael Scott',
      customer_email: 'michael.scott@dundermifflin.com',
      assignee_name: 'Unassigned'
    },
    {
      title: 'Typo in invoicing PDF footer',
      description: 'There is a small typo in the address listed in the footer of our PDF invoices. It says "123 Main Stree" instead of "Street". Please correct this on the next billing cycle.',
      status: 'Solved',
      priority: 'Low',
      customer_name: 'Pam Beesly',
      customer_email: 'pam@dundermifflin.com',
      assignee_name: 'Emily Watson (Billing)'
    }
  ];

  const stmt = db.prepare(`
    INSERT INTO tickets (title, description, status, priority, customer_name, customer_email, assignee_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  initialTickets.forEach((t) => {
    stmt.run(t.title, t.description, t.status, t.priority, t.customer_name, t.customer_email, t.assignee_name, function(err) {
      if (err) {
        console.error('Error seeding ticket:', err.message);
        return;
      }
      
      const ticketId = this.lastID;
      // Add initial comment for the tickets
      if (ticketId === 1) {
        db.run(`
          INSERT INTO comments (ticket_id, author_name, author_role, message)
          VALUES 
            (?, ?, 'Customer', 'Can someone please look into this? I have an urgent report to complete.'),
            (?, ?, 'Agent', 'Hi John, I am looking into this now. It seems like a permissions caching issue on your user profile. I am refreshing it now. Please try again in 5 minutes.')
        `, ticketId, 'John Doe', ticketId, 'Sarah Connor (Agent)');
      } else if (ticketId === 2) {
        db.run(`
          INSERT INTO comments (ticket_id, author_name, author_role, message)
          VALUES 
            (?, ?, 'Agent', 'Hi Alice, the rate limit is 10,000 requests per minute. For webhooks, we retry 5 times with exponential backoff. Let me double check if we can raise this limit for you.')
        `, ticketId, 'Dave Miller (API Support)');
      } else if (ticketId === 4) {
        db.run(`
          INSERT INTO comments (ticket_id, author_name, author_role, message)
          VALUES 
            (?, ?, 'Agent', 'Hi Pam, I have updated the template. The typo is fixed, and your future invoices will display "Street". Marking this ticket as solved!')
        `, ticketId, 'Emily Watson (Billing)');
      }
    });
  });

  stmt.finalize();
}

module.exports = db;
