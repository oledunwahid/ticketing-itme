const { sendWhatsApp } = require('../services/fonnte');

const token = "Wu2xW5TcrCS8xQg8j6Xu";
const target = "083818317005";
const message = "Tiket pelaporan anda sudah dibuat";

console.log("Starting live test...");
sendWhatsApp(target, message)
  .then(res => {
    console.log("TEST RESULT:");
    console.log(JSON.stringify(res, null, 2));
  })
  .catch(err => {
    console.error("FATAL ERROR:", err);
  });
