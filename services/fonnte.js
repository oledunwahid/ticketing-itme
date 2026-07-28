const CONFIG = {
  fonnteToken: process.env.FONNTE_TOKEN || 'Wu2xW5TcrCS8xQg8j6Xu',
  fonnteEndpoint: process.env.FONNTE_ENDPOINT || 'https://api.fonnte.com/send',
};

/**
 * Formats a phone number to standard international format (without + symbol).
 * Defaults to Indonesia (62) country code if the number has a local format.
 *
 * @param {string} phone - Raw input phone number (e.g. "0812-3456-7890", "+62 8123456789", "08123456789")
 * @returns {string} Cleaned, formatted phone number (e.g. "6281234567890")
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';

  const raw = String(phone).trim();

  // Support WhatsApp Group targets (e.g. 120363xxx@g.us)
  if (raw.includes('@g.us')) {
    return raw;
  }

  // Remove all non-numeric characters (keep only digits)
  let cleaned = raw.replace(/\D/g, '');

  // Handle local Indonesian prefix '0' (e.g., '0812...')
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  }

  // Handle Indonesia local format starting with '8' directly (e.g., '812...')
  // Indonesian mobile numbers usually have 9 to 13 digits (excluding prefix)
  if (cleaned.startsWith('8') && cleaned.length >= 9 && cleaned.length <= 13) {
    cleaned = '62' + cleaned;
  }

  return cleaned;
}

/**
 * Automatically send a WhatsApp message to the recipient's phone number or group using Fonnte API.
 * Handles phone number / group cleaning and formatting before sending.
 *
 * @param {string} phone - The recipient's phone/WhatsApp number or Group ID
 * @param {string} ticketNumber - The generated ticket number
 * @param {string} [customMessage] - Optional custom message body
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function sendWhatsApp(phone, ticketNumber, customMessage) {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    if (!formattedPhone) {
      throw new Error('Invalid or missing recipient phone number.');
    }

    if (!CONFIG.fonnteToken) {
      throw new Error('Fonnte API Token is not configured.');
    }

    const message = customMessage || `Tiket pelaporan anda sudah dibuat tiket anda adalah : ${ticketNumber}`;

    const payload = {
      target: formattedPhone,
      message: message
    };

    const response = await fetch(CONFIG.fonnteEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': CONFIG.fonnteToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok || data.status === false) {
      const errorMsg = data.reason || data.detail || `Fonnte API responded with status ${response.status}`;
      return { success: false, error: errorMsg, data };
    }

    return { success: true, data };
  } catch (err) {
    console.error('[Fonnte] Error sending WhatsApp:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  formatPhoneNumber,
  sendWhatsApp,
  CONFIG
};
