const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'omnidesk-super-secret-key-2026-xyz';

// Setup directories for uploads and temp uploads
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TEMP_DIR = path.join(UPLOADS_DIR, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Multer config for file chunk parsing
const upload = multer({ dest: TEMP_DIR });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('dev'));



// Auth Middleware
function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      res.clearCookie('token');
      return res.status(401).json({ error: 'Unauthorized. Session expired or invalid.' });
    }

    // Absolute session expiration check (24 hours)
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (decoded.absolute_exp && nowSeconds > decoded.absolute_exp) {
      res.clearCookie('token');
      return res.status(401).json({ error: 'Unauthorized. Session absolute lifetime expired.' });
    }

    // sliding inactivity window: refresh cookie for another 30 mins
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 60 * 1000 // 30 minutes
    });

    req.user = decoded;
    next();
  });
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden. Access denied.' });
    }
    next();
  };
}

// ==========================================================================
// Authentication Endpoints
// ==========================================================================

// Register
app.post('/api/auth/register', (req, res) => {
  const { username, email, password, passwordConfirm, brand } = req.body;

  if (!username || !email || !password || !passwordConfirm) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (password !== passwordConfirm) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address format' });
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{10,}$/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({ error: 'Password does not meet complexity requirements' });
  }

  if (brand !== undefined && brand !== null && brand !== '') {
    const validBrands = ['UNION', 'IBR', 'FRENCH', 'CORK', 'GROUP'];
    if (!validBrands.includes(brand)) {
      return res.status(400).json({ error: 'Invalid brand value' });
    }
  }

  db.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)', [email, username], (err, existingUser) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already in use' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    db.run(
      'INSERT INTO users (username, email, password_hash, role, brand) VALUES (?, ?, ?, "Customer", ?)',
      [username, email.toLowerCase(), passwordHash, brand || null],
      function(insertErr) {
        if (insertErr) {
          return res.status(500).json({ error: 'Failed to register user' });
        }
        res.status(201).json({ message: 'Registration successful! Please log in.' });
      }
    );
  });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  db.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }



    const absoluteExp = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 hours
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        brand: user.brand,
        absolute_exp: absoluteExp
      },
      JWT_SECRET
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 60 * 1000 // 30 minutes
    });

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      brand: user.brand
    });
  });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Me (Session Verification)
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    email: req.user.email,
    role: req.user.role,
    brand: req.user.brand
  });
});

// ==========================================================================
// User Management Endpoints (Agent Only)
// ==========================================================================

// Get all users
app.get('/api/users', requireAuth, requireRole(['Agent']), (req, res) => {
  db.all('SELECT id, username, email, role, brand, created_at FROM users ORDER BY id ASC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Create user
app.post('/api/users', requireAuth, requireRole(['Agent']), (req, res) => {
  const { username, email, password, role, brand } = req.body;

  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const validRoles = ['Customer', 'Agent'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role value' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address format' });
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{10,}$/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({ error: 'Password does not meet complexity requirements' });
  }

  if (brand !== undefined && brand !== null && brand !== '') {
    const validBrands = ['UNION', 'IBR', 'FRENCH', 'CORK', 'GROUP'];
    if (!validBrands.includes(brand)) {
      return res.status(400).json({ error: 'Invalid brand value' });
    }
  }

  db.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)', [email, username], (err, existingUser) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already in use' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    db.run(
      'INSERT INTO users (username, email, password_hash, role, brand) VALUES (?, ?, ?, ?, ?)',
      [username, email.toLowerCase(), passwordHash, role, brand || null],
      function(insertErr) {
        if (insertErr) {
          return res.status(500).json({ error: 'Failed to create user' });
        }
        res.status(201).json({ id: this.lastID, username, email, role, brand: brand || null });
      }
    );
  });
});

// Edit user
app.patch('/api/users/:id', requireAuth, requireRole(['Agent']), (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { username, email, role, password, brand } = req.body;

  if (isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  const updates = [];
  const params = [];

  if (username) {
    updates.push('username = ?');
    params.push(username);
  }

  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address format' });
    }
    updates.push('email = ?');
    params.push(email.toLowerCase());
  }

  if (role) {
    const validRoles = ['Customer', 'Agent'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role value' });
    }

    // Prevent self-demotion
    if (userId === req.user.id && role !== 'Agent') {
      return res.status(400).json({ error: 'You cannot change your own Agent role.' });
    }

    updates.push('role = ?');
    params.push(role);
  }

  if (password) {
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{10,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: 'Password does not meet complexity requirements' });
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    updates.push('password_hash = ?');
    params.push(passwordHash);
  }

  if (brand !== undefined) {
    const validBrands = [null, '', 'UNION', 'IBR', 'FRENCH', 'CORK', 'GROUP'];
    if (brand && !validBrands.includes(brand)) {
      return res.status(400).json({ error: 'Invalid brand value' });
    }
    updates.push('brand = ?');
    params.push(brand || null);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update provided' });
  }

  const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
  params.push(userId);

  db.run(query, params, function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ id: userId, username, email, role, brand });
  });
});

// Delete user
app.delete('/api/users/:id', requireAuth, requireRole(['Agent']), (req, res) => {
  const userId = parseInt(req.params.id, 10);

  if (isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  // Prevent self-deletion
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own logged-in account.' });
  }

  db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true });
  });
});

// API Routes

// 1. Get statistics for the dashboard
app.get('/api/stats', requireAuth, requireRole(['Agent']), (req, res) => {
  const stats = {
    total: 0,
    new: 0,
    open: 0,
    pending: 0,
    solved: 0,
    closed: 0,
    urgent: 0
  };

  db.all('SELECT status, priority FROM tickets', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    stats.total = rows.length;
    rows.forEach(row => {
      // Count statuses
      if (row.status === 'New') stats.new++;
      else if (row.status === 'Open') stats.open++;
      else if (row.status === 'Pending') stats.pending++;
      else if (row.status === 'Solved') stats.solved++;
      else if (row.status === 'Closed') stats.closed++;

      // Count urgents
      if (row.priority === 'Urgent') {
        stats.urgent++;
      }
    });

    res.json(stats);
  });
});

// 2. Get all tickets (with optional search and filter query parameters)
app.get('/api/tickets', requireAuth, (req, res) => {
  const { status, priority, search } = req.query;
  let query = 'SELECT * FROM tickets WHERE 1=1';
  const params = [];

  // RBAC isolation: Customers only see their own tickets
  if (req.user.role === 'Customer') {
    query += ' AND customer_email = ?';
    params.push(req.user.email);
  }

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  if (priority) {
    query += ' AND priority = ?';
    params.push(priority);
  }

  if (search) {
    query += ' AND (title LIKE ? OR description LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)';
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam, searchParam);
  }

  // Order priority: Urgent first, then High, Medium, Low. Then order by creation time.
  query += ` ORDER BY 
    CASE priority 
      WHEN 'Urgent' THEN 1 
      WHEN 'High' THEN 2 
      WHEN 'Medium' THEN 3 
      WHEN 'Low' THEN 4 
    END ASC, 
    created_at DESC`;

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// 3. Get single ticket with comments and attachments
app.get('/api/tickets/:id', requireAuth, (req, res) => {
  const ticketId = req.params.id;

  db.get('SELECT * FROM tickets WHERE id = ?', [ticketId], (err, ticket) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // RBAC isolation: Customers only see their own tickets
    if (req.user.role === 'Customer' && ticket.customer_email !== req.user.email) {
      return res.status(403).json({ error: 'Forbidden. Access denied.' });
    }

    db.all('SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC', [ticketId], (err, comments) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      db.all('SELECT * FROM attachments WHERE ticket_id = ?', [ticketId], (attachErr, attachments) => {
        if (attachErr) {
          return res.status(500).json({ error: attachErr.message });
        }
        res.json({ ticket, comments, attachments });
      });
    });
  });
});

// 4. Create a new ticket (with optional attachments)
app.post('/api/tickets', requireAuth, (req, res) => {
  const { title, description, priority, customer_name, customer_email, attachmentIds } = req.body;

  // For Customer, force their authenticated credentials
  let finalName = customer_name;
  let finalEmail = customer_email;
  if (req.user.role === 'Customer') {
    finalName = req.user.username;
    finalEmail = req.user.email;
  }

  if (!title || !description || !finalName || !finalEmail) {
    return res.status(400).json({ error: 'Missing required fields: title, description, customer_name, customer_email' });
  }

  const validPriorities = ['Low', 'Medium', 'High', 'Urgent'];
  const ticketPriority = validPriorities.includes(priority) ? priority : 'Low';

  const query = `
    INSERT INTO tickets (title, description, status, priority, customer_name, customer_email, assignee_name)
    VALUES (?, ?, 'New', ?, ?, ?, 'Unassigned')
  `;

  db.run(query, [title, description, ticketPriority, finalName, finalEmail], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const newTicketId = this.lastID;
    
    const finishTicketCreation = () => {
      db.get('SELECT * FROM tickets WHERE id = ?', [newTicketId], (err, ticket) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json(ticket);
      });
    };

    if (attachmentIds && Array.isArray(attachmentIds) && attachmentIds.length > 0) {
      const placeholders = attachmentIds.map(() => '?').join(',');
      const updateQuery = `UPDATE attachments SET ticket_id = ? WHERE id IN (${placeholders})`;
      db.run(updateQuery, [newTicketId, ...attachmentIds], (updateErr) => {
        if (updateErr) {
          console.error('Error linking attachments to ticket:', updateErr.message);
        }
        finishTicketCreation();
      });
    } else {
      finishTicketCreation();
    }
  });
});

// 5. Update a ticket (status, priority, assignee) - Agent Only
app.patch('/api/tickets/:id', requireAuth, requireRole(['Agent']), (req, res) => {
  const ticketId = req.params.id;
  const { status, priority, assignee_name } = req.body;

  // Build dynamic update query
  const updates = [];
  const params = [];

  if (status) {
    const validStatuses = ['New', 'Open', 'Pending', 'Solved', 'Closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    updates.push('status = ?');
    params.push(status);
  }

  if (priority) {
    const validPriorities = ['Low', 'Medium', 'High', 'Urgent'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority value' });
    }
    updates.push('priority = ?');
    params.push(priority);
  }

  if (assignee_name !== undefined) {
    updates.push('assignee_name = ?');
    params.push(assignee_name || 'Unassigned');
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update provided' });
  }

  // Add standard updated_at column
  updates.push('updated_at = CURRENT_TIMESTAMP');
  
  const query = `UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`;
  params.push(ticketId);

  db.run(query, params, function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // System log message as comment on status changes
    let logMessage = '';
    if (status && assignee_name) {
      logMessage = `Ticket status changed to "${status}" and assigned to "${assignee_name}"`;
    } else if (status) {
      logMessage = `Ticket status changed to "${status}"`;
    } else if (assignee_name) {
      logMessage = `Ticket assigned to "${assignee_name}"`;
    }

    if (logMessage) {
      db.run('INSERT INTO comments (ticket_id, author_name, author_role, message) VALUES (?, ?, ?, ?)', 
        [ticketId, 'System', 'Agent', logMessage], (commentErr) => {
          if (commentErr) console.error('Error creating system comment:', commentErr.message);
        }
      );
    }

    // Return the updated ticket
    db.get('SELECT * FROM tickets WHERE id = ?', [ticketId], (err, ticket) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(ticket);
    });
  });
});

// 6. Add comment/reply to ticket
app.post('/api/tickets/:id/comments', requireAuth, (req, res) => {
  const ticketId = req.params.id;
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Missing required fields: message' });
  }

  // Verify ticket exists and access control
  db.get('SELECT id, status, customer_email FROM tickets WHERE id = ?', [ticketId], (err, ticket) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // RBAC: Customer can only comment on their own tickets
    if (req.user.role === 'Customer' && ticket.customer_email !== req.user.email) {
      return res.status(403).json({ error: 'Forbidden. Access denied.' });
    }

    const authorName = req.user.username;
    const authorRole = req.user.role; // Customer or Agent

    // Insert comment
    db.run(
      'INSERT INTO comments (ticket_id, author_name, author_role, message) VALUES (?, ?, ?, ?)',
      [ticketId, authorName, authorRole, message],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        const newCommentId = this.lastID;

        // Automatically update the ticket updated_at field
        let statusUpdateSql = 'UPDATE tickets SET updated_at = CURRENT_TIMESTAMP';
        const statusUpdateParams = [];
        
        if (authorRole === 'Agent' && ticket.status === 'New') {
          statusUpdateSql += ', status = ?';
          statusUpdateParams.push('Open');
          
          // Log status change comment
          db.run('INSERT INTO comments (ticket_id, author_name, author_role, message) VALUES (?, ?, ?, ?)', 
            [ticketId, 'System', 'Agent', 'Ticket status changed to "Open" automatically on agent reply'], 
            (commentErr) => { if (commentErr) console.error(commentErr); }
          );
        }

        statusUpdateSql += ' WHERE id = ?';
        statusUpdateParams.push(ticketId);

        db.run(statusUpdateSql, statusUpdateParams, (updateErr) => {
          if (updateErr) {
            console.error('Error updating ticket time/status:', updateErr.message);
          }
          
          // Return the created comment
          db.get('SELECT * FROM comments WHERE id = ?', [newCommentId], (err, comment) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.status(201).json(comment);
          });
        });
      }
    );
  });
});

// ==========================================================================
// Attachment Upload Routing & Validators
// ==========================================================================

const ALLOWED_MIMES = {
  // Images
  'image/jpeg': ['ffd8ff'],
  'image/jpg': ['ffd8ff'],
  'image/png': ['89504e47'],
  'image/gif': ['47494638'],
  'image/webp': ['52494646', '57454250'], // RIFF...WEBP
  // Videos
  'video/mp4': ['66747970'], // ftyp
  'video/webm': ['1a45dfa3'], // EBML
  'video/quicktime': ['6d6f6f76', '66747970'] // moov or ftyp
};

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

// Magic byte validation helper
function checkMagicBytes(filePath, mimeType) {
  const signatures = ALLOWED_MIMES[mimeType];
  if (!signatures) return false;

  try {
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    const fileHex = buffer.toString('hex').toLowerCase();

    // Verify the hex strings
    return signatures.some(signature => {
      if (mimeType === 'image/webp') {
        // WEBP starts with RIFF (52494646) and has WEBP (57454250) at offset 8
        return fileHex.startsWith('52494646') && fileHex.substring(16, 24) === '57454250';
      }
      if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') {
        // MP4/MOV check box structure
        return fileHex.substring(8, 16) === '66747970' || fileHex.substring(8, 16) === '6d6f6f76';
      }
      return fileHex.startsWith(signature.toLowerCase());
    });
  } catch (err) {
    console.error('Error checking magic bytes:', err);
    return false;
  }
}

// Validator helper
function validateFile(filePath, mimeType, size) {
  if (!ALLOWED_MIMES[mimeType]) {
    return 'Unsupported file format.';
  }
  const isVideo = mimeType.startsWith('video/');
  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (size > maxSize) {
    return `File exceeds maximum size limit of ${isVideo ? '100MB' : '10MB'}.`;
  }
  if (!checkMagicBytes(filePath, mimeType)) {
    return 'File validation failed: File signature (magic bytes) mismatch.';
  }
  return null; // Valid
}

// 1. Direct upload for images / small files
app.post('/api/attachments/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const { path: tempPath, originalname, mimetype, size } = req.file;
  const validationError = validateFile(tempPath, mimetype, size);
  if (validationError) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    return res.status(400).json({ error: validationError });
  }

  // Sanitize filename & generate unguessable UUID for storage
  const sanitizedName = originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileId = crypto.randomUUID();
  const destPath = path.join(UPLOADS_DIR, fileId);

  try {
    fs.renameSync(tempPath, destPath);
  } catch (err) {
    console.error('Error saving file:', err);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    return res.status(500).json({ error: 'Failed to save attachment file.' });
  }

  const fileUrl = `/api/attachments/${fileId}`;

  db.run(
    'INSERT INTO attachments (id, ticket_id, file_url, file_name, file_size, mime_type, uploaded_by) VALUES (?, NULL, ?, ?, ?, ?, ?)',
    [fileId, fileUrl, sanitizedName, size, mimetype, req.user.id],
    (err) => {
      if (err) {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({ id: fileId, file_url: fileUrl, file_name: sanitizedName, file_size: size, mime_type: mimetype });
    }
  );
});

// 2. Chunked upload endpoint (large files / videos)
app.post('/api/attachments/upload-chunk', requireAuth, upload.single('chunk'), (req, res) => {
  const { fileId, chunkIndex, totalChunks, fileName, mimeType, fileSize } = req.body;
  
  if (!req.file) {
    return res.status(400).json({ error: 'No file chunk received.' });
  }

  const idx = parseInt(chunkIndex, 10);
  const total = parseInt(totalChunks, 10);
  const size = parseInt(fileSize, 10);

  if (!fileId || isNaN(idx) || isNaN(total) || !fileName || !mimeType || isNaN(size)) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Missing chunk metadata properties.' });
  }

  // Pre-validate MIME and size limits
  if (!ALLOWED_MIMES[mimeType]) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Unsupported file format.' });
  }
  const isVideo = mimeType.startsWith('video/');
  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (size > maxSize) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'File exceeds maximum size limits.' });
  }

  const tempFilePath = path.join(TEMP_DIR, `part_${fileId}`);

  try {
    const chunkData = fs.readFileSync(req.file.path);
    fs.appendFileSync(tempFilePath, chunkData);
    fs.unlinkSync(req.file.path); // remove multer temp file chunk
  } catch (err) {
    console.error('Error assembling file chunk:', err);
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ error: 'Failed to process file chunk.' });
  }

  // Final chunk received -> finalize assembly and validate
  if (idx === total - 1) {
    const validationError = validateFile(tempFilePath, mimeType, size);
    if (validationError) {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      return res.status(400).json({ error: validationError });
    }

    const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const finalPath = path.join(UPLOADS_DIR, fileId);

    try {
      fs.renameSync(tempFilePath, finalPath);
    } catch (err) {
      console.error('Error finalizing chunked upload:', err);
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      return res.status(500).json({ error: 'Failed to assemble chunked upload.' });
    }

    const fileUrl = `/api/attachments/${fileId}`;

    db.run(
      'INSERT INTO attachments (id, ticket_id, file_url, file_name, file_size, mime_type, uploaded_by) VALUES (?, NULL, ?, ?, ?, ?, ?)',
      [fileId, fileUrl, sanitizedName, size, mimeType, req.user.id],
      (err) => {
        if (err) {
          if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ id: fileId, file_url: fileUrl, file_name: sanitizedName, file_size: size, mime_type: mimeType });
      }
    );
  } else {
    res.json({ status: 'chunk_uploaded', chunkIndex: idx });
  }
});

// 3. Delete attachment
app.delete('/api/attachments/:id', requireAuth, (req, res) => {
  const attachmentId = req.params.id;
  
  db.get('SELECT * FROM attachments WHERE id = ?', [attachmentId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Attachment not found.' });

    // RBAC: Customer can only delete their own uploaded attachments
    if (req.user.role === 'Customer' && row.uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden. Access denied.' });
    }

    db.run('DELETE FROM attachments WHERE id = ?', [attachmentId], (deleteErr) => {
      if (deleteErr) return res.status(500).json({ error: deleteErr.message });

      const filePath = path.join(UPLOADS_DIR, attachmentId);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Error unlinking file:', err);
        }
      }
      res.json({ success: true });
    });
  });
});

// 4. Secure File Access Point (Access Control)
app.get('/api/attachments/:id', requireAuth, (req, res) => {
  const attachmentId = req.params.id;
  
  db.get('SELECT * FROM attachments WHERE id = ?', [attachmentId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Attachment reference not found.' });
    }

    const sendFileResponse = () => {
      const filePath = path.join(UPLOADS_DIR, attachmentId);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found on server disk.' });
      }

      res.setHeader('Content-Type', row.mime_type);
      const safeName = encodeURIComponent(row.file_name);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${safeName}`);
      res.sendFile(filePath);
    };

    // RBAC: Agents see all. Customers must either have uploaded it OR be linked to the ticket
    if (req.user.role === 'Agent') {
      return sendFileResponse();
    }

    // Customer Checks
    if (row.ticket_id) {
      db.get('SELECT customer_email FROM tickets WHERE id = ?', [row.ticket_id], (tErr, ticket) => {
        if (tErr) return res.status(500).json({ error: tErr.message });
        if (!ticket || ticket.customer_email !== req.user.email) {
          return res.status(403).json({ error: 'Forbidden. Access denied.' });
        }
        sendFileResponse();
      });
    } else {
      if (row.uploaded_by !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden. Access denied.' });
      }
      sendFileResponse();
    }
  });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// SPA Wildcard Route: serve index.html for all non-api routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong on the server!' });
});

// Start listening
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log('Serving frontend from /public folder');
});
