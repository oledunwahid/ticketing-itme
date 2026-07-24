const http = require('http');
const app = require('../app');
const db = require('../database');

let server;

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      const cookies = res.headers['set-cookie'];
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), cookies, headers: res.headers });
        } catch (_) {
          resolve({ status: res.statusCode, body: data, cookies, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runHttpTests() {
  await db.ready;
  const PORT = 3999;
  server = app.listen(PORT, '127.0.0.1');

  console.log("=== STARTING HTTP API VERIFICATION ===");

  // 1. Login as SuperAdmin
  const loginRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'agent@omnidesk.com', password: 'Password123!' });

  console.log("1. Login response status:", loginRes.status, "User role:", loginRes.body.role);
  if (loginRes.status !== 200) throw new Error("Login failed");

  const cookie = loginRes.cookies ? loginRes.cookies[0].split(';')[0] : '';

  // 2. Change Password API Test
  const changePwRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/api/auth/change-password',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
  }, { oldPassword: 'Password123!', newPassword: 'Password123!', confirmPassword: 'Password123!' });

  console.log("2. Change Password response status:", changePwRes.status, "Message:", changePwRes.body.message || changePwRes.body.error);
  if (changePwRes.status !== 200) throw new Error("Change password failed");

  // 3. Departments Meta API Test
  const deptRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/api/meta/departments',
    method: 'GET',
    headers: { 'Cookie': cookie }
  });
  console.log("3. Departments list:", deptRes.body);

  // 4. Create Ticket via API (Request Form)
  const ticketRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/api/tickets',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
  }, {
    requestor_name: "Fauzi HTTP Requestor",
    department: "IT",
    outlet_code: "UTP",
    category: "POS System",
    description: "Testing ticket creation via HTTP API",
    urgency: "High"
  });

  console.log("4. Ticket creation response status:", ticketRes.status, "Ticket #:", ticketRes.body.ticket_number, "Customer:", ticketRes.body.customer_name);
  if (ticketRes.status !== 201) throw new Error("Ticket creation failed: " + JSON.stringify(ticketRes.body));

  const ticketId = ticketRes.body.id;

  // 5. Test Multi-Technician Assignment via API
  const edi = await db.pGet("SELECT id FROM users WHERE LOWER(username) = 'edi'");
  if (edi) {
    const assignPrimaryRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/tickets/${ticketId}/assign`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
    }, { technician_id: edi.id, role_type: 'primary' });

    console.log("5a. Assign Primary status:", assignPrimaryRes.status);

    const edi2 = await db.pGet("SELECT id FROM users WHERE role = 'TechnicianIT' AND id != ? LIMIT 1", [edi.id]);
    if (edi2) {
      const assignCollabRes = await request({
        hostname: '127.0.0.1',
        port: PORT,
        path: `/api/tickets/${ticketId}/assign`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
      }, { technician_id: edi2.id, role_type: 'collaborator' });

      console.log("5b. Assign Collaborator status:", assignCollabRes.status);
    }
  }

  // 6. Get Ticket Details API Test
  const detailRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: `/api/tickets/${ticketId}`,
    method: 'GET',
    headers: { 'Cookie': cookie }
  });

  console.log("6. Ticket detail fetch status:", detailRes.status);
  console.log("   Primary Tech:", detailRes.body.primaryTechnician ? detailRes.body.primaryTechnician.technician_name : 'None');
  console.log("   Collaborators count:", detailRes.body.collaborators ? detailRes.body.collaborators.length : 0);

  console.log("=== HTTP API VERIFICATION PASSED ===");
  server.close();
  process.exit(0);
}

runHttpTests().catch(err => {
  console.error("HTTP verification error:", err);
  if (server) server.close();
  process.exit(1);
});
