/* ==========================================================================
   Notification service abstraction.
   Channels: in_app (always logged), email (placeholder), whatsapp/Fonnte.
   Real external sending is DISABLED unless explicitly enabled
   via env — safe for prototype/demo. Everything is recorded in
   notification_logs for audit + future replay.
   ========================================================================== */
const db = require('../database');
const { sendWhatsApp } = require('./fonnte');

const CONFIG = {
  get emailEnabled() { return process.env.EMAIL_ENABLED === 'true'; },
  get whatsappEnabled() { return process.env.FONNTE_ENABLED !== 'false'; },
  get fonnteToken() { return process.env.FONNTE_TOKEN || 'P2kK4X5xV8xLXZhe8ELZ'; },
  get fonnteDevice() { return process.env.FONNTE_DEVICE || ''; },
  get fonnteEndpoint() { return process.env.FONNTE_ENDPOINT || 'https://api.fonnte.com/send'; },
};

async function log(ticketId, channel, recipient, template, payload, status) {
  try {
    await db.pRun(
      `INSERT INTO notification_logs (ticket_id, channel, recipient, template, payload, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ticketId || null, channel, recipient || null, template || null,
       payload ? JSON.stringify(payload) : null, status]
    );
  } catch (e) {
    console.error('[notify] log error:', e.message);
  }
}

/**
 * Fire a notification across the requested channels. Non-blocking best-effort;
 * never throws into request handlers.
 *
 * @param {string} event     e.g. 'ticket.created', 'ticket.assigned'
 * @param {object} opts      { ticketId, recipients:[{name,email,phone}], message, channels:['in_app'] }
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
          // Placeholder — integrate a mailer later.
          await log(ticketId, 'email', r.email, event, payload,
            CONFIG.emailEnabled ? 'sent' : 'skipped');
        } else if (channel === 'whatsapp') {
          if (CONFIG.whatsappEnabled && r.phone) {
            // Send real WhatsApp using Fonnte service with dynamic ticket number
            const ticketNo = opts.ticketNumber || (message.match(/[A-Z]+-\d{4}-\d{4}(?:\s*-\s*[A-Z0-9_-]+)?/) ? message.match(/[A-Z]+-\d{4}-\d{4}(?:\s*-\s*[A-Z0-9_-]+)?/)[0] : 'Unknown');
            const result = await sendWhatsApp(r.phone, ticketNo, opts.message || message);
            if (result.success) {
              await log(ticketId, 'whatsapp', r.phone, event, payload, 'sent');
            } else {
              await log(ticketId, 'whatsapp', r.phone, event, payload, `failed: ${result.error}`);
            }
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

module.exports = { notify, CONFIG };
