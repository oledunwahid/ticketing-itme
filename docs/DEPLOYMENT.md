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
| `JWT_SECRET` | Secret key for signing JWT auth cookies (**Required in production**) | `replace-with-a-long-random-secret` |
| `EMAIL_ENABLED` | Enable email notifications (`true`/`false`) | `false` |
| `FONNTE_ENABLED`| Enable WhatsApp notifications via Fonnte (`true`/`false`) | `false` |

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
   FROM node:18-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --only=production
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
         - JWT_SECRET=synology-prod-secret-key-12345
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
