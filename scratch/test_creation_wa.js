const { notify } = require('../services/notifications');

async function testTicketCreationWA() {
  const displayTicketNumber = 'IT-2026-0038 - CSPP';
  const department = 'IT';
  const outletCode = 'CSPP';
  const requestorName = 'Budi (Outlet Manager)';
  const contactNumber = '081234567890';
  const title = 'Printer Kasir 1 Macet & Offline';
  const description = 'Printer kasir mati total dan tidak bisa cetak struk sejak jam 5 sore.';

  const techGroupTarget = (department === 'ME' ? process.env.FONNTE_WA_GROUP_ME : process.env.FONNTE_WA_GROUP_IT) || process.env.FONNTE_WA_GROUP || '120363410098180945@g.us';

  const groupAlertMessage = `🚨 *TIKET BARU TERBUAT* 🚨\n• *Nomor Tiket*: ${displayTicketNumber}\n• *Departemen*: ${department}\n• *Kategori*: Hardware / Printer\n• *Outlet*: ${outletCode}\n• *Pelapor*: ${requestorName} (${contactNumber})\n• *Judul*: ${title}\n• *Deskripsi*: ${description}`;

  console.log('Dispatching WhatsApp notification to target group:', techGroupTarget);
  
  await notify('ticket.created', {
    ticketId: 100,
    ticketNumber: displayTicketNumber,
    recipients: [{ name: 'IT Technician Group', phone: techGroupTarget }],
    message: groupAlertMessage,
    channels: ['whatsapp']
  });

  console.log('Simulation dispatch finished.');
}

testTicketCreationWA();
