/* Live WhatsApp send test (sends a REAL message).
   Usage:  FONNTE_TOKEN=... node examples/test-live-send.js <phone> ["message"]
   The token is read from the environment / .env — never hard-code it. */
require('../src/config/env');
const { sendWhatsApp } = require('../services/fonnte');

const target = process.argv[2];
const message = process.argv[3] || 'Tiket pelaporan anda sudah dibuat';
if (!target || !process.env.FONNTE_TOKEN) {
  console.error('Usage: FONNTE_TOKEN=... node examples/test-live-send.js <phone> ["message"]');
  process.exit(1);
}

console.log('Starting live test...');
sendWhatsApp(target, 'TEST', message)
  .then((res) => {
    console.log('TEST RESULT:');
    console.log(JSON.stringify(res, null, 2));
  })
  .catch((err) => {
    console.error('FATAL ERROR:', err);
  });
