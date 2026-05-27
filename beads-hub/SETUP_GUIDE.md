# Beads Agent Hub — Setup Guide

Complete instructions for deploying the multi-agent personal assistant on **Windows** (prototyping) and **Raspberry Pi** (production).

---

## Architecture overview

```
Browser (phone/laptop/desktop)
    │
    ▼
┌─────────────────────────────────────┐
│  Node.js + Express (port 3000)      │
│                                     │
│  ┌───────────┐  ┌────────────────┐  │
│  │ Anthropic  │  │ Beads (bd CLI) │  │
│  │ API proxy  │  │ → Dolt DB     │  │
│  └───────────┘  └────────────────┘  │
│                                     │
│  ┌───────────┐  ┌────────────────┐  │
│  │ SQLite    │  │ Google OAuth   │  │
│  │ chat hist │  │ (optional)     │  │
│  └───────────┘  └────────────────┘  │
│                                     │
│  Static React frontend (dist/)      │
└─────────────────────────────────────┘
```

**Five agents:** Bridge (orchestrator), Hearth (life/school), Ledger (finance), Keeper (properties), Forge (maker)
**Auth:** Session-based login (multi-user ready)
**Secrets:** SOPS/age encryption for production, plaintext .env for local dev

---

## Part 1: Windows Setup (Prototyping)

### 1.1 Prerequisites

Install these if you don't have them:

**Node.js 20+**
Download from https://nodejs.org/ (LTS version). Verify:
```powershell
node --version    # v20.x.x or higher
npm --version
```

**Git**
Download from https://git-scm.com/download/win. Verify:
```powershell
git --version
```

### 1.2 Install Beads

Open PowerShell as Administrator:

```powershell
# Option A: npm (easiest on Windows)
npm install -g @beads/bd

# Option B: Go (if you have Go installed)
go install github.com/steveyegge/beads/cmd/bd@latest

# Option C: Download binary from GitHub releases
# https://github.com/steveyegge/beads/releases
# Download the Windows .exe, place it in a directory on your PATH
```

Verify:
```powershell
bd --version
```

Initialize a Beads project:
```powershell
mkdir C:\Users\YourName\beads-project
cd C:\Users\YourName\beads-project
bd init
bd create "Test task" -p 2
bd list
```

### 1.3 Set up the Hub

```powershell
# Clone or extract the project
cd C:\Users\YourName\Projects
# (copy beads-hub folder here)

cd beads-hub
npm install
```

> **Note:** `better-sqlite3` compiles native code. On Windows you need the
> "Desktop development with C++" workload from Visual Studio Build Tools.
> If npm install fails, run:
> ```powershell
> npm install --global windows-build-tools
> # or install Visual Studio Build Tools from
> # https://visualstudio.microsoft.com/visual-cpp-build-tools/
> ```

### 1.4 Configure environment

```powershell
copy .env.example .env
notepad .env
```

Set these values:
```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
PORT=3000
HOST=0.0.0.0
DB_PATH=./data/hub.db
BEADS_PROJECT_DIR=C:/Users/YourName/beads-project
DEFAULT_PASSWORD=your-secure-password
SESSION_SECRET=any-random-string-here
```

> **Important:** Use forward slashes (`/`) in paths, even on Windows.

### 1.5 Run in development mode

```powershell
npm run dev
```

This starts both the backend (port 3000) and Vite dev server (port 5173) with hot reload. Open http://localhost:5173 in your browser.

**First login:** username `admin`, password is whatever you set as `DEFAULT_PASSWORD`.

### 1.6 Build and run in production mode

```powershell
npm run build
npm start
```

Open http://localhost:3000. The built frontend is served by Express directly.

---

## Part 2: Raspberry Pi Setup (Production)

### 2.1 Prerequisites

| Item | Notes |
|------|-------|
| Raspberry Pi 4 or 5 | 4GB+ RAM recommended |
| microSD card 32GB+ | With Raspberry Pi OS (64-bit Lite) |
| Network | Ethernet or WiFi |
| Anthropic API key | https://console.anthropic.com/ |

### 2.2 Flash and connect

1. Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/) to flash **Raspberry Pi OS (64-bit) Lite**
2. In the imager settings, enable SSH, set username/password, configure WiFi
3. Boot and connect:

```bash
ssh your-username@raspberrypi.local
```

Update:
```bash
sudo apt update && sudo apt upgrade -y
```

### 2.3 Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3
node --version
```

### 2.4 Install Beads

```bash
# Install script
curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash

# Or via npm
npm install -g @beads/bd

# Verify
bd --version

# Initialize project
mkdir -p ~/beads-project && cd ~/beads-project && bd init
```

If `bd` isn't found after install:
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 2.5 Install SOPS and age (secrets management)

```bash
# Install age
sudo apt install -y age

# Install SOPS
ARCH=$(dpkg --print-architecture)
sudo curl -fsSL -o /usr/local/bin/sops \
  "https://github.com/getsops/sops/releases/download/v3.9.4/sops-v3.9.4.linux.${ARCH}"
sudo chmod +x /usr/local/bin/sops

# Verify
sops --version
age --version
```

### 2.6 Set up encrypted secrets

```bash
# Generate an age key pair
mkdir -p ~/beads-hub/secrets
age-keygen -o ~/beads-hub/secrets/age-key.txt

# Note the public key printed — you'll need it
# It looks like: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Create your .env file with real values
cd ~/beads-hub
cp .env.example .env
nano .env
# Fill in ANTHROPIC_API_KEY, SESSION_SECRET, etc.

# Encrypt it with SOPS
export SOPS_AGE_RECIPIENTS="age1your-public-key-here"
sops -e .env > secrets/.env.enc

# Verify you can decrypt
sops -d secrets/.env.enc

# Delete the plaintext .env (secrets are now encrypted)
rm .env

# Protect the age key
chmod 600 ~/beads-hub/secrets/age-key.txt
```

The entrypoint script will decrypt `secrets/.env.enc` using the age key at startup. The decrypted values only exist in memory.

### 2.7 Deploy the Hub

```bash
cd ~/beads-hub
npm install
npm run build
```

**Test it:**
```bash
# For testing without SOPS (create a temporary .env)
cp .env.example .env
nano .env  # fill in values
npm start

# Or with SOPS
export SOPS_AGE_KEY_FILE=~/beads-hub/secrets/age-key.txt
source <(sops -d secrets/.env.enc)
npm start
```

Access from your network at `http://raspberrypi.local:3000`

### 2.8 Run as a systemd service

```bash
sudo nano /etc/systemd/system/beads-hub.service
```

```ini
[Unit]
Description=Beads Agent Hub
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/beads-hub
ExecStartPre=/bin/bash -c 'export SOPS_AGE_KEY_FILE=/home/your-username/beads-hub/secrets/age-key.txt && sops -d /home/your-username/beads-hub/secrets/.env.enc > /tmp/beads-hub.env'
ExecStart=/usr/bin/node server.js
EnvironmentFile=/tmp/beads-hub.env
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable beads-hub
sudo systemctl start beads-hub
sudo systemctl status beads-hub

# View logs
journalctl -u beads-hub -f
```

### 2.9 Container deployment (alternative to systemd)

If you prefer Docker/Podman:

```bash
# Install Docker on Pi
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in

# Build and run
cd ~/beads-hub
docker compose up -d --build

# View logs
docker compose logs -f

cd ~/Documents/git/beads-hub/beads-hub
docker compose logs -f     # tail
docker compose restart     # restart after a change
docker compose down        # stop (your ./data persists)
docker compose up -d --build   # rebuild after editing server.js / src/
```

The `docker-compose.yml` mounts volumes for persistent data and reads secrets from `./secrets/`.

---

## Part 3: Google OAuth Setup (Optional, Either Platform)

**Important HTTPS note:** Google requires HTTPS for all OAuth redirect URIs *except* `localhost`. This means:
- **Windows dev:** `http://localhost:3000/auth/google/callback` works without TLS — Google specifically exempts localhost
- **Pi on local network:** `http://raspberrypi.local:3000/auth/google/callback` will **not** work for an External app — use `http://localhost:3000/auth/google/callback` and tunnel via SSH, or set the app to Internal (test-only)
- **Production with a domain:** requires HTTPS — use Caddy or similar for auto-TLS, then `https://beadshub.yourdomain.com/auth/google/callback`

For prototyping, the simplest approach is to keep the OAuth consent screen in **Testing** mode (which allows up to 100 test users and permits HTTP redirects) and add your email as a test user. You only need External + HTTPS when you publish the app for broader use.

### 3.1 Create Google Cloud project

1. Go to https://console.cloud.google.com/
2. Create a new project (e.g., "Beads Agent Hub")
3. **APIs & Services > Library** — enable:
   - Gmail API
   - Google Calendar API
4. **APIs & Services > Credentials** — Create **OAuth 2.0 Client ID**:
   - Type: Web application
   - Authorized redirect URIs:
     - `http://localhost:3000/auth/google/callback` (works for both Windows and Pi during development)
     - `https://beadshub.yourdomain.com/auth/google/callback` (production, when you have a domain + TLS)

### 3.2 Configure OAuth consent screen

1. **APIs & Services > OAuth consent screen**
2. For prototyping: choose **Internal** (Google Workspace) or **External** in **Testing** mode
3. Add your email as a test user
4. Add scopes:
   - `gmail.readonly`, `gmail.compose`
   - `calendar.readonly`, `calendar.events`

**Note on Testing vs Published:** In Testing mode, tokens expire after 7 days and you'll need to re-authenticate. When you're ready for permanent use, publish the app (which requires HTTPS redirect URIs and may require Google's verification for sensitive scopes like Gmail).

### 3.3 Add credentials

You only need one set of OAuth credentials — both Google accounts authenticate through the same app:

Add to your `.env` (or encrypted `.env.enc`):
```
GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

### 3.4 Authenticate both accounts

The Hub stores separate tokens per account. Authenticate each one:

1. Restart the server
2. **Personal Google:** Visit `http://localhost:3000/auth/google?account=personal`
   - Sign in with your personal Gmail
   - Token saved to `data/google-tokens-personal.json`
3. **Georgetown Google:** Visit `http://localhost:3000/auth/google?account=georgetown`
   - Sign in with your Georgetown email
   - Token saved to `data/google-tokens-georgetown.json`

Both accounts will show as "connected" in the sidebar.

**Agent-to-account routing:**
- Hearth, Ledger, Keeper → personal Google
- Scholar → Georgetown Google
- Bridge → both accounts (merges results for briefings)
- Forge → no Google access

**Note:** If Georgetown's Google Workspace blocks third-party apps, you may need to contact Georgetown IT to allowlist your OAuth client ID, or keep the OAuth consent screen in Testing mode with your Georgetown email added as a test user.

---

## Part 4: Multi-User Setup

### Adding family members

Once logged in as admin, family members can be added via the API:

```bash
# From any terminal with curl
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -d '{"username":"spouse","displayName":"Your Spouse","password":"their-password"}'
```

Each user gets their own conversation history. Beads are shared across the household (stored in the same Dolt database).

### Per-user agent context

Each user can have personalized context injected into agent conversations. Set via the API:

```bash
curl -X PUT http://localhost:3000/api/context/hearth \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -d '{"notes":"I am a night-school masters student at Georgetown starting June 2026. I work full-time during the day."}'
```

The agent will receive this context with every message from that user.

---

## Part 5: Backups

### Beads (Dolt push)

The safest backup for the Dolt database is using Dolt's native sync:

```bash
cd ~/beads-project

# Add a remote (DoltHub, or a self-hosted Dolt remote)
dolt remote add backup https://doltremoteapi.dolthub.com/your-username/beads-backup

# Push (run manually or via cron)
dolt push backup main
```

Add to crontab for automatic hourly backups:
```bash
crontab -e
# Add:
0 * * * * cd /home/your-username/beads-project && dolt add . && dolt commit -m "auto-backup" && dolt push backup main 2>/dev/null
```

### SQLite chat history

```bash
# Copy to a backup location (safe while server is running due to WAL mode)
cp ~/beads-hub/data/hub.db /path/to/backup/hub-$(date +\%Y\%m\%d).db
```

Or sync to Google Drive via rclone:
```bash
sudo apt install rclone
rclone config  # set up Google Drive remote
rclone copy ~/beads-hub/data/hub.db gdrive:backups/beads-hub/
```

---

## Part 6: Remote Access (Optional)

### Tailscale (recommended)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Access from anywhere via Tailscale IP. Zero port forwarding needed.

### Caddy reverse proxy with HTTPS

```bash
sudo apt install caddy
sudo nano /etc/caddy/Caddyfile
```

```
beadshub.yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl restart caddy
```

Caddy auto-provisions TLS certificates via Let's Encrypt.

---

## Useful commands

| Task | Command |
|------|---------|
| Start dev mode | `npm run dev` |
| Build frontend | `npm run build` |
| Start production | `npm start` |
| View beads | `cd ~/beads-project && bd list` |
| Ready tasks | `bd ready` |
| Create task | `bd create "Title" -p 0` |
| Server logs (systemd) | `journalctl -u beads-hub -f` |
| Server logs (Docker) | `docker compose logs -f` |
| Restart (systemd) | `sudo systemctl restart beads-hub` |
| Restart (Docker) | `docker compose restart` |
| Decrypt secrets | `sops -d secrets/.env.enc` |
| Re-encrypt secrets | `sops -e .env > secrets/.env.enc` |

---

## Troubleshooting

**"bd: command not found"**
Add `~/.local/bin` to PATH. On Windows, ensure the npm global bin directory is in your PATH (`npm config get prefix`).

**"better-sqlite3" build fails**
Windows: install Visual Studio Build Tools with C++ workload.
Pi: `sudo apt install build-essential python3 g++`.

**"ANTHROPIC_API_KEY not configured"**
Check that .env exists and is sourced, or that SOPS decryption is working (`sops -d secrets/.env.enc`).

**Google OAuth "redirect_uri_mismatch"**
The redirect URI in Google Cloud Console must exactly match GOOGLE_REDIRECT_URI in your env — including protocol, host, port, and path.

**Slow responses on Pi**
The API call takes a few seconds regardless of hardware. If very slow, check internet speed and consider using `claude-haiku-4-5-20251001` as the model (set CLAUDE_MODEL in .env).

**Mobile layout issues**
The app switches to mobile layout below 768px viewport width. If the layout looks wrong, check that the viewport meta tag hasn't been overridden by a browser extension.
