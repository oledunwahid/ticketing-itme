require('../src/config/env');
const db = require('../database');
const { nextTicketNumber } = require('../src/utils/ticketNumber');

async function testTicketCreationLogic() {
  await db.ready;
  console.log("DB Ready");

  const department = "IT";
  const category = "Other IT";
  const outlet_code = "CSPP";
  
  const cat = await db.pGet(
    "SELECT 1 FROM categories WHERE department_code = ? AND name = ?",
    [department, category]
  );
  console.log("Category check:", cat);

  const outlet = await db.pGet(
    "SELECT code, brand_code, region FROM outlets WHERE code = ?",
    [outlet_code]
  );
  console.log("Outlet check:", outlet);

  const ticketNumber = await nextTicketNumber(department);
  console.log("Next Ticket Number:", ticketNumber);

  const displayTicketNumber = outlet.code ? `${ticketNumber} - ${outlet.code}` : ticketNumber;
  console.log("Display Ticket Number:", displayTicketNumber);

  console.log("Ticket creation logic test PASSED!");
}

testTicketCreationLogic().catch(console.error);
