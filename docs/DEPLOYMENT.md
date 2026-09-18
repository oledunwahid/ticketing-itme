# Deployment & Startup Guide — IT-ME Ticketing System

This document outlines the deployment, startup, and troubleshooting procedures for the IT-ME Ticketing System across three environments:
1. **Local Development**
2. **Static On-Premise PC Deployment**
3. **Synology NAS Deployment**

---

## 1. System Requirements & Environment Variables

### Requirements
- **Node.js**: `v18.0.0` or higher (`node -v`)
- **npm**: `v9.0.0` or higher (`npm -v`)
- **Storage**: Minimum 500MB (for application files, SQLite database, and media uploads)

### Required `.env` Variables

Create or configure `.env` in the root directory:

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `NODE_ENV` | Environment mode (`development` or `production`) | `development` |
| `PORT` | HTTP listening port | `3001` |
| `HOST` | Binding IP interface (`0.0.0.0` allows local network access) | `0.0.0.0` |
| `DB_PATH` | Absolute or relative path to SQLite database file | `./tickets.db` |
| `JWT_SECRET` | Secret for signing session tokens (**required in production**, 32+ random chars) | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `APP_URL` | Public URL used in WhatsApp links; its scheme also sets the cookie `Secure` flag | `http://192.168.1.100:3001` |
| `COOKIE_SECURE` | Force the cookie `Secure` flag (only needed behind an HTTPS proxy) | *(auto from APP_URL)* |
| `TRUST_PROXY` | Set when a reverse proxy is in front so rate limits see real IPs | `1` |
| `CORS_ORIGINS` | Extra origins allowed to call the API (same-origin needs nothing) | *(empty)* |
| `UPLOADS_DIR` | Where attachments are stored | `./uploads` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | First start on an **empty** DB: create this SuperAdmin instead of demo accounts | *(empty)* |
| `EMAIL_ENABLED` | Enable email notifications (`true`/`false`) | `false` |
| `FONNTE_ENABLED`| WhatsApp via Fonnte; sends only when `FONNTE_TOKEN` is set and this is not `false` | `false` |
| `FONNTE_TOKEN` | Fonnte API token (**never commit it**) | *(empty)* |
| `FONNTE_WA_GROUP` / `_IT` / `_ME` | Technician WhatsApp group ids (`…@g.us`) | *(empty)* |

> **Plain HTTP on the LAN is supported.** The session cookie is only marked `Secure`
> when `APP_URL` starts with `https://` (or `COOKIE_SECURE=true`); otherwise browsers
> would silently drop it and nobody could sign in.

---

## 2. Environment Setup Instructions

### Environment 1: Local Development

1. **Clone repository & checkout branch**:
   ```bash
   git clone <repository-url>
   cd ticketing-itme
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   ```

4. **Start the application**:
   ```bash
   npm run dev
   ```
   Access the web app in browser at: `http://localhost:3001`

---

### Environment 2: Static On-Premise PC Deployment (Windows / Linux PC)

For a dedicated PC on the local shop/office network:

1. **Prerequisites**:
   - Install Node.js v18 LTS on the PC.
   - Configure Windows Firewall / Linux UFW to allow incoming TCP traffic on port `3001`.

2. **Setup**:
   - Extract/clone application files into a dedicated folder (e.g. `C:\ITME-Ticketing` or `/opt/itme-ticketing`).
   - Run `npm install --production`.
   - Create `.env`:
     ```env
     NODE_ENV=production
     PORT=3001
     HOST=0.0.0.0
     DB_PATH=./tickets.db
     JWT_SECRET=super-secret-key-change-this-for-production!
     ```

3. **Process Manager / Windows Service Setup**:
   - Use PM2 or NSSM (Non-Sucking Service Manager) to run the application as a background service:
     ```bash
     npm install -g pm2
     pm2 start app.js --name "itme-ticketing"
     pm2 save
     pm2 startup
     ```

4. **Accessing the App**:
   - Network devices on the same LAN can access the system via the server PC's IP address:
     `http://<SERVERS_LOCAL_IP>:3001` (e.g., `http://192.168.1.100:3001`)

---

### Environment 3: Synology NAS Deployment (Container Station / Docker)

To run the application reliably on a Synology NAS using Container Manager:

1. **Docker Setup**:
   - Open **Container Manager** on Synology DSM.
   - Create a project directory, e.g. `/volume1/docker/itme-ticketing`.
   - Create two persistent subdirectories for database and file uploads:
     - `/volume1/docker/itme-ticketing/data/`
     - `/volume1/docker/itme-ticketing/uploads/`

2. **Dockerfile**:
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --omit=dev
   COPY . .
   EXPOSE 3001
   ENV NODE_ENV=production
   ENV HOST=0.0.0.0
   ENV PORT=3001
   ENV DB_PATH=/app/data/tickets.db
   CMD ["node", "app.js"]
   ```

3. **Docker Compose / Container Manager Configuration**:
   ```yaml
   version: '3.8'
   services:
     itme-ticketing:
       build: .
       container_name: itme-ticketing
       restart: always
       ports:
         - "3001:3001"
       environment:
         - NODE_ENV=production
         - PORT=3001
         - HOST=0.0.0.0
         - DB_PATH=/app/data/tickets.db
         - JWT_SECRET=${JWT_SECRET}          # put the real value in .env, not here
         - APP_URL=http://<SYNOLOGY_IP>:3001
         - UPLOADS_DIR=/app/uploads
       volumes:
         - /volume1/docker/itme-ticketing/data:/app/data
         - /volume1/docker/itme-ticketing/uploads:/app/uploads
   ```

4. **Accessing the NAS App**:
   - Open `http://<SYNOLOGY_IP>:3001` from any local device.

---

## 3. How to Start, Stop, and Restart

- **Local / PM2**:
  ```bash
  pm2 status
  pm2 restart itme-ticketing
  pm2 stop itme-ticketing
  ```
- **Synology Docker**:
  ```bash
  docker-compose restart
  # or use Synology Container Manager UI -> Action -> Restart
  ```

---

## 4. Common Troubleshooting

1. **App fails to boot with `FATAL: JWT_SECRET must be set in production`**:
   - Ensure `JWT_SECRET` is defined in `.env` when `NODE_ENV=production`.

2. **Cannot connect from other PCs on local network**:
   - Ensure `HOST=0.0.0.0` in `.env`.
   - Check firewall rules on the host machine to allow incoming TCP connections on PORT `3001`.

3. **SQLite Database Locked or Permission Denied**:
   - Verify read/write permissions on the directory containing `tickets.db` (especially on Linux / Synology volume mounts).

4. **Uploaded attachments missing after container restart**:
   - Ensure `/app/uploads` and `/app/data` are mounted to persistent host volumes.

5. **Everyone gets "Too many attempts" at once**:
   - A reverse proxy is hiding client IPs. Set `TRUST_PROXY=1`. (Only *failed* sign-ins count towards the limit.)

6. **Users are signed out after a password reset / role change**:
   - Expected: changing a password, role or deactivating an account revokes that user's sessions immediately.

## 5. Loading real master data

1. Start on an empty database with `ADMIN_EMAIL` / `ADMIN_PASSWORD` set, so no demo accounts are created. Remove `ADMIN_PASSWORD` from `.env` after the first start.
2. Sign in as that SuperAdmin and open **Import / Export**.
3. **Download template**. It has a README sheet explaining every column, plus one sheet each for Brands, Locations, Categories, Users, Schedules and User outlets.
4. Fill in the sheets in Excel and upload them with **Import workbook**. The app checks every row first and saves nothing until all rows are valid. Row numbers in the check match Excel.
5. New users need an `initial_password`. Delete those passwords from your copy of the file once the import is done.

Re-importing the same workbook updates existing rows; imports never delete anything. **Export current data** gives you the same workbook filled in, ready to edit and import again.

## 6. Health check & verification

- `GET /api/health` → `{"ok":true}` (no auth, no data) — use it for uptime monitoring.
- Before deploying a new version: `npm ci && npm run check` (ESLint + API test suite on a throw-away database).

## 7. Backups

SQLite runs in WAL mode. Back up with a consistent snapshot instead of copying the file while the app writes:

```bash
node -e "const s=require('sqlite3');new s.Database('tickets.db').run(\"VACUUM INTO 'backups/tickets-'||strftime('%Y%m%d-%H%M','now')||'.db'\")"
```

Back up the `uploads/` folder alongside it. Keep backups **out of git** (`backups/` is ignored).
