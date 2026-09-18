/* ==========================================================================
   Notification service abstraction.
   Channels: in_app (always logged), email (placeholder), whatsapp/Fonnte.
   WhatsApp sends only when a FONNTE_TOKEN is configured and FONNTE_ENABLED is
   not "false". Everything is recorded in notification_logs for audit.
   Sending is fire-and-forget: callers never await delivery.
   ========================================================================== */
const db = require('../database');
const { sendWhatsApp, CONFIG: FONNTE } = require('./fonnte');

const CONFIG = {
  get emailEnabled() { return process.env.EMAIL_ENABLED === 'true'; },
  get whatsappEnabled() { return process.env.FONNTE_ENABLED !== 'false' && !!FONNTE.fonnteToken; },
};

if (process.env.FONNTE_ENABLED === 'true' && !FONNTE.fonnteToken) {
  console.warn('[notify] FONNTE_ENABLED=true but FONNTE_TOKEN is empty. WhatsApp messages will be skipped.');
}

async function log(ticketId, channel, recipient, template, payload, status) {
  try {
    await db.pRun(
      `INSERT INTO notification_logs (ticket_id, channel, recipient, template, payload, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ticketId || null, channel, recipient || null, template || null,
       payload ? JSON.stringify(payload) : null, String(status).slice(0, 255)]
    );
  } catch (e) {
    console.error('[notify] log error:', e.message);
  }
}

/**
 * Fire a notification across the requested channels. Best-effort; never
 * throws into request handlers.
 *
 * @param {string} event     e.g. 'ticket.created', 'ticket.assigned'
 * @param {object} opts      { ticketId, ticketNumber, recipients:[{name,email,phone}], message, channels:['in_app'] }
 */
async function notify(event, opts = {}) {
  const { ticketId, recipients = [], message = '', channels = ['in_app'] } = opts;
  const payload = { event, message };

  for (const r of recipients) {
    for (const channel of channels) {
      try {
        if (channel === 'in_app') {
          await log(ticketId, 'in_app', r.email || r.name, event, payload, 'sent');
        } else if (channel === 'email') {
          await log(ticketId, 'email', r.email, event, payload,
            CONFIG.emailEnabled ? 'sent' : 'skipped');
        } else if (channel === 'whatsapp') {
          if (CONFIG.whatsappEnabled && r.phone) {
            const result = await sendWhatsApp(r.phone, opts.ticketNumber || 'Unknown', message);
            await log(ticketId, 'whatsapp', r.phone, event, payload,
              result.success ? 'sent' : `failed: ${result.error}`);
          } else {
            await log(ticketId, 'whatsapp', r.phone, event, payload, 'skipped');
          }
        }
      } catch (e) {
        await log(ticketId, channel, r.email || r.phone, event, payload, 'failed');
      }
    }
  }
}

// WhatsApp group for a department's technicians (configured in .env).
function technicianGroupTarget(department) {
  return (department === 'ME' ? process.env.FONNTE_WA_GROUP_ME : process.env.FONNTE_WA_GROUP_IT)
    || process.env.FONNTE_WA_GROUP || '';
}

/* Alert the department (group + admins/technicians with a phone) about a new
   ticket. De-duplicates recipients by number. */
async function alertNewTicket({ ticketId, department, displayNumber, message }) {
  const recipients = [];
  const group = technicianGroupTarget(department);
  if (group) recipients.push({ name: `${department} Technician Group`, phone: group });
  const staff = await db.pAll(
    `SELECT username, phone FROM users
      WHERE is_active = 1 AND phone IS NOT NULL AND phone != ''
        AND role IN ('SuperAdmin', ?, ?)`,
    [department === 'IT' ? 'AdminIT' : 'AdminME', department === 'IT' ? 'TechnicianIT' : 'TechnicianME']
  );
  for (const s of staff) {
    if (!recipients.some((r) => r.phone === s.phone)) recipients.push({ name: s.username, phone: s.phone });
  }
  if (recipients.length) {
    notify('ticket.created', {
      ticketId,
      ticketNumber: displayNumber,
      recipients,
      message,
      channels: ['whatsapp'],
    });
  }
}

module.exports = { notify, alertNewTicket, technicianGroupTarget, CONFIG };
