const { sendWhatsApp, formatPhoneNumber } = require('../services/fonnte');

// Example parameters
const rawPhoneNumber = "0812-3456-7890";
const ticketNumber = "IT-2026-0018";

console.log(`Original Number:  "${rawPhoneNumber}"`);
console.log(`Formatted Number: "${formatPhoneNumber(rawPhoneNumber)}"`);
console.log(`Ticket Number:    "${ticketNumber}"`);
console.log(`Sending WhatsApp message...`);

// Trigger the automation function with phone number and ticket number as parameters
sendWhatsApp(rawPhoneNumber, ticketNumber)
  .then(result => {
    if (result.success) {
      console.log('WhatsApp message sent successfully!');
      console.log('API Response:', JSON.stringify(result.data, null, 2));
    } else {
      console.error('Failed to send WhatsApp message.');
      console.error('Error Details:', result.error);
      if (result.data) {
        console.error('API Response:', JSON.stringify(result.data, null, 2));
      }
    }
  })
  .catch(err => {
    console.error('Unexpected error occurred:', err);
  });
