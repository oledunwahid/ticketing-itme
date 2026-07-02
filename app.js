const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use(morgan('dev'));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// 1. Get statistics for the dashboard
app.get('/api/stats', (req, res) => {
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
app.get('/api/tickets', (req, res) => {
  const { status, priority, search } = req.query;
  let query = 'SELECT * FROM tickets WHERE 1=1';
  const params = [];

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
app.get('/api/tickets/:id', (req, res) => {
  const ticketId = req.params.id;

  db.get('SELECT * FROM tickets WHERE id = ?', [ticketId], (err, ticket) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
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
app.post('/api/tickets', (req, res) => {
  const { title, description, priority, customer_name, customer_email, attachmentIds } = req.body;

  if (!title || !description || !customer_name || !customer_email) {
    return res.status(400).json({ error: 'Missing required fields: title, description, customer_name, customer_email' });
  }

  const validPriorities = ['Low', 'Medium', 'High', 'Urgent'];
  const ticketPriority = validPriorities.includes(priority) ? priority : 'Low';

  const query = `
    INSERT INTO tickets (title, description, status, priority, customer_name, customer_email, assignee_name)
    VALUES (?, ?, 'New', ?, ?, ?, 'Unassigned')
  `;

  db.run(query, [title, description, ticketPriority, customer_name, customer_email], function(err) {
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

// 5. Update a ticket (status, priority, assignee)
app.patch('/api/tickets/:id', (req, res) => {
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
app.post('/api/tickets/:id/comments', (req, res) => {
  const ticketId = req.params.id;
  const { author_name, author_role, message } = req.body;

  if (!author_name || !author_role || !message) {
    return res.status(400).json({ error: 'Missing required fields: author_name, author_role, message' });
  }

  const validRoles = ['Customer', 'Agent'];
  if (!validRoles.includes(author_role)) {
    return res.status(400).json({ error: 'Invalid author_role. Must be "Customer" or "Agent"' });
  }

  // Verify ticket exists
  db.get('SELECT id, status FROM tickets WHERE id = ?', [ticketId], (err, ticket) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Insert comment
    db.run(
      'INSERT INTO comments (ticket_id, author_name, author_role, message) VALUES (?, ?, ?, ?)',
      [ticketId, author_name, author_role, message],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        const newCommentId = this.lastID;

        // Automatically update the ticket updated_at field
        // If an agent replies, we might want to change status from "New" to "Open" automatically, just like Zendesk
        let statusUpdateSql = 'UPDATE tickets SET updated_at = CURRENT_TIMESTAMP';
        const statusUpdateParams = [];
        
        if (author_role === 'Agent' && ticket.status === 'New') {
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
app.post('/api/attachments/upload', upload.single('file'), (req, res) => {
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
    'INSERT INTO attachments (id, ticket_id, file_url, file_name, file_size, mime_type) VALUES (?, NULL, ?, ?, ?, ?)',
    [fileId, fileUrl, sanitizedName, size, mimetype],
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
app.post('/api/attachments/upload-chunk', upload.single('chunk'), (req, res) => {
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
      'INSERT INTO attachments (id, ticket_id, file_url, file_name, file_size, mime_type) VALUES (?, NULL, ?, ?, ?, ?)',
      [fileId, fileUrl, sanitizedName, size, mimeType],
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
app.delete('/api/attachments/:id', (req, res) => {
  const attachmentId = req.params.id;
  
  db.get('SELECT * FROM attachments WHERE id = ?', [attachmentId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Attachment not found.' });

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
app.get('/api/attachments/:id', (req, res) => {
  const attachmentId = req.params.id;
  
  db.get('SELECT * FROM attachments WHERE id = ?', [attachmentId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Attachment reference not found.' });
    }

    const filePath = path.join(UPLOADS_DIR, attachmentId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on server disk.' });
    }

    res.setHeader('Content-Type', row.mime_type);
    const safeName = encodeURIComponent(row.file_name);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${safeName}`);
    res.sendFile(filePath);
  });
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
