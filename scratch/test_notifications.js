require('../src/config/env');
const { sendWhatsApp } = require('../services/fonnte');

async function testSend() {
  const targetPhone = "083818317005";
  const targetGroupIT = process.env.FONNTE_WA_GROUP_IT || "120363410098180945@g.us";

  console.log("=========================================");
  console.log("Fonnte API Token:", process.env.FONNTE_TOKEN);
  console.log("=========================================");

  console.log(`\n1. Sending test notification to Phone (${targetPhone})...`);
  const res1 = await sendWhatsApp(targetPhone, "TICK-TEST-0001", "[TEST] Halo, ini pesan uji coba notifikasi ke nomor 083818317005.");
  console.log("Phone Test Result:", JSON.stringify(res1, null, 2));

  console.log(`\n2. Sending test notification to WA Group TEKNISI IT (${targetGroupIT})...`);
  const res2 = await sendWhatsApp(targetGroupIT, "TICK-TEST-0002", "[TEST] Halo TEKNISI IT, ini pesan uji coba notifikasi ke Group WhatsApp.");
  console.log("Group Test Result:", JSON.stringify(res2, null, 2));
}

testSend();
