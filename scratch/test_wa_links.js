require('../src/config/env');
const { notify } = require('../services/notifications');
const { APP_URL } = require('../src/config/env');

async function testNoJudulFormat() {
  const targetPhone = "083818317005";
  const displayTicketNumber = "ME-2026-0007 - UCP";
  const ticketId = 7;
  const ticketUrl = `${APP_URL}/tickets/${ticketId}`;

  const groupAlertMessage = `🚨 *TIKET BARU TERBUAT* 🚨\n• *Nomor Tiket*: ${displayTicketNumber}\n👉 ${ticketUrl}\n• *Departemen*: ME\n• *Kategori*: Electrical\n• *Outlet*: UCP\n• *Pelapor*: Requestor Test (${targetPhone})\n• *Deskripsi*: RUSAK AIR (TEST WA)`;

  console.log("Sample Updated WA Message (Judul Removed):\n" + groupAlertMessage);

  await notify("ticket.created", {
    ticketId,
    ticketNumber: displayTicketNumber,
    recipients: [{ name: "IT Group", phone: targetPhone }],
    message: groupAlertMessage,
    channels: ["whatsapp"],
  });

  console.log("\nSent successfully!");
}

testNoJudulFormat();
