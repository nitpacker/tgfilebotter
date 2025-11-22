# CloudFlare Tunnel + VPN Setup Guide
## Hide Your Home IP While Hosting

This guide shows you how to expose your server to the internet without revealing your home IP address.

---

# Option A: CloudFlare Tunnel (Recommended - FREE)

CloudFlare Tunnel creates a secure connection from your server to CloudFlare's network, without opening ports on your router.

## Benefits
✅ **FREE** (no cost)
✅ **No port forwarding** needed
✅ **Your IP hidden** (CloudFlare's IP shown publicly)
✅ **Free SSL** (HTTPS automatic)
✅ **DDoS protection** included
✅ **No VPN needed** for inbound traffic

## Step-by-Step Setup

### Step 1: Create CloudFlare Account

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up (free account)
3. Verify your email

---

### Step 2: Add Your Domain to CloudFlare

1. **In CloudFlare dashboard:**
   - Click "Add site"
   - Enter: `qzz.io` (your root domain)
   - Select "Free" plan
   - Click "Continue"

2. **Update Nameservers:**
   - CloudFlare shows you 2 nameservers like:
     ```
     dana.ns.cloudflare.com
     scott.ns.cloudflare.com
     ```
   
3. **At afraid.org:**
   - Log in to afraid.org
   - Go to your domain settings
   - Change nameservers to CloudFlare's
   - Wait 5-60 minutes for DNS propagation

4. **Back in CloudFlare:**
   - Click "Done, check nameservers"
   - Wait for status: "Active"

---

### Step 3: Install CloudFlare Tunnel on Your Server

**On your Linux server:**

```bash
# Download cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

# Install
sudo dpkg -i cloudflared-linux-amd64.deb

# Verify installation
cloudflared --version
```

**Expected output:**
```
cloudflared version 2024.X.X
```

---

### Step 4: Authenticate CloudFlare Tunnel

```bash
# Login to CloudFlare
cloudflared tunnel login
```

**What happens:**
1. Opens browser with CloudFlare login
2. Login with your CloudFlare account
3. Select domain: `qzz.io`
4. Authorize

**Terminal shows:**
```
You have successfully logged in.
```

A certificate is saved to: `~/.cloudflared/cert.pem`

---

### Step 5: Create Tunnel

```bash
# Create tunnel named "tgbot-tunnel"
cloudflared tunnel create tgbot-tunnel
```

**Output:**
```
Tunnel credentials written to: ~/.cloudflared/<TUNNEL-ID>.json
Created tunnel tgbot-tunnel with id <TUNNEL-ID>
```

**Save the TUNNEL-ID** (you'll need it)

---

### Step 6: Configure Tunnel

**Create config file:**

```bash
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

**Add this content:**

```yaml
tunnel: <YOUR-TUNNEL-ID>
credentials-file: /root/.cloudflared/<YOUR-TUNNEL-ID>.json

ingress:
  - hostname: tgfiler.qzz.io
    service: http://localhost:3000
  - hostname: www.tgfiler.qzz.io
    service: http://localhost:3000
  - service: http_status:404
```

**Replace:**
- `<YOUR-TUNNEL-ID>` with your actual tunnel ID
- Keep `localhost:3000` (your Node.js server port)

**Save:** Ctrl+X, Y, Enter

---

### Step 7: Route DNS to Tunnel

```bash
cloudflared tunnel route dns tgbot-tunnel tgfiler.qzz.io
```

**Output:**
```
Successfully routed tunnel tgbot-tunnel to tgfiler.qzz.io
```

**Repeat for www:**
```bash
cloudflared tunnel route dns tgbot-tunnel www.tgfiler.qzz.io
```

---

### Step 8: Copy Credentials to /root/

```bash
# Copy tunnel credentials
sudo cp ~/.cloudflared/*.json /root/.cloudflared/

# Set permissions
sudo chmod 600 /root/.cloudflared/*.json
```

---

### Step 9: Install as System Service

```bash
# Install service
sudo cloudflared service install

# Enable auto-start
sudo systemctl enable cloudflared

# Start service
sudo systemctl start cloudflared

# Check status
sudo systemctl status cloudflared
```

**Expected status:**
```
● cloudflared.service - cloudflared
   Active: active (running)
```

---

### Step 10: Update Your Code

**No code changes needed!** But update these files:

#### 1. Update Uploader Config

**File:** `uploader/config.py`

Change:
```python
SERVER_URL = "https://tgfiler.qzz.io"  # Note: HTTPS, not HTTP
```

Rebuild executable:
```powershell
.\build_uploader.ps1
```

#### 2. Update Deployment Scripts (Optional)

**File:** `scripts/install.sh`

The Caddy configuration can be simplified since CloudFlare handles HTTPS:

```bash
# Change Caddyfile to:
cat > /etc/caddy/Caddyfile << 'EOF'
:3000 {
    reverse_proxy localhost:3000
}
EOF
```

Or just keep existing Caddy config - either works.

---

### Step 11: Test Your Setup

**Wait 2-3 minutes for tunnel to be fully active, then test:**

```bash
# From any device (not your server)
curl https://tgfiler.qzz.io/health
```

**Expected:**
```json
{"status":"ok","timestamp":"2024-..."}
```

**In browser:**
```
https://tgfiler.qzz.io/admin
```

Should see admin login page with green padlock (HTTPS).

---

### Step 12: Verify IP is Hidden

**Check what IP is visible:**

```bash
# See what IP the public sees
nslookup tgfiler.qzz.io
```

**Expected:**
- Shows CloudFlare IP (not your home IP)
- Something like: `104.21.x.x` or `172.67.x.x`

**Your home IP is now hidden!** ✅

---

## Firewall Configuration

**Since CloudFlare Tunnel creates outbound connection, you don't need to open incoming ports!**

**Update your firewall:**

```bash
# You can now block port 3000 from internet (only allow localhost)
# CloudFlare tunnel connects outbound, so no incoming ports needed

# Remove previous port forwards from router
# Just keep SSH (port 22) if you need remote access
```

---

## Troubleshooting CloudFlare Tunnel

### Tunnel not connecting

**Check logs:**
```bash
sudo journalctl -u cloudflared -f
```

**Common issues:**
- Wrong tunnel ID in config.yml
- Credentials file path incorrect
- Server port wrong (should be 3000)

### Website shows 502 Bad Gateway

**Cause:** Your Node.js server isn't running

**Fix:**
```bash
# Check if server is running
curl http://localhost:3000/health

# If not, start it
cd /opt/telegram-bot-system/backend
npm start
```

### DNS not resolving

**Wait time:** DNS can take up to 5 minutes to propagate

**Check:**
```bash
nslookup tgfiler.qzz.io
```

Should show CloudFlare IPs.

---

# Option B: VPN for Outbound Traffic (Optional)

If you also want to hide your IP for outbound connections (when your bots connect to Telegram), use a VPN.

## ProtonVPN Free Setup

### Step 1: Install ProtonVPN

**On Linux:**

```bash
# Download ProtonVPN
wget https://protonvpn.com/download/protonvpn-stable-release_1.0.1-1_all.deb

# Install
sudo apt install ./protonvpn-stable-release_1.0.1-1_all.deb

# Update
sudo apt update

# Install ProtonVPN
sudo apt install protonvpn
```

### Step 2: Login

```bash
protonvpn-cli login
```

Enter:
- Your ProtonVPN username
- Your ProtonVPN password

### Step 3: Connect

```bash
# Connect to fastest free server
protonvpn-cli connect --fastest
```

**Expected:**
```
Connecting to XX-FREE#XX...
Connected!
Your IP: XXX.XXX.XXX.XXX
```

### Step 4: Verify

```bash
# Check your public IP
curl ifconfig.me
```

Should show ProtonVPN IP (not your real IP).

### Step 5: Auto-Connect on Boot (Optional)

```bash
# Create systemd service
sudo nano /etc/systemd/system/protonvpn-autoconnect.service
```

**Add:**
```ini
[Unit]
Description=ProtonVPN Auto-Connect
After=network.target

[Service]
Type=forking
ExecStart=/usr/bin/protonvpn-cli connect --fastest
ExecStop=/usr/bin/protonvpn-cli disconnect
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

**Enable:**
```bash
sudo systemctl enable protonvpn-autoconnect
sudo systemctl start protonvpn-autoconnect
```

---

## Combining CloudFlare Tunnel + VPN

**This is the MAXIMUM privacy setup:**

1. **CloudFlare Tunnel** hides your IP for **inbound** traffic (people accessing your site)
2. **VPN** hides your IP for **outbound** traffic (your bots connecting to Telegram)

**Setup order:**
1. Setup CloudFlare Tunnel first (Steps 1-12 above)
2. Setup VPN after (Steps 1-5 above)
3. Test everything works

**Result:**
- Website visitors see CloudFlare IP
- Telegram sees VPN IP
- Your real home IP is hidden in both directions

---

# Comparison: CloudFlare vs Traditional Port Forwarding

| Feature | Port Forwarding | CloudFlare Tunnel |
|---------|----------------|-------------------|
| Setup Difficulty | Medium | Easy |
| Your IP Exposed | ✗ Yes | ✓ Hidden |
| Ports to Open | 80, 443 | None |
| SSL Certificate | Manual | Automatic |
| DDoS Protection | ✗ None | ✓ Included |
| Router Config | Required | Not needed |
| Cost | Free | Free |

**Winner:** CloudFlare Tunnel for privacy and ease!

---

# Cost Summary

| Service | Cost |
|---------|------|
| CloudFlare Tunnel | FREE |
| CloudFlare DNS | FREE |
| ProtonVPN Free | FREE |
| **Total Monthly Cost** | **$0.00** |

---

# Final Architecture

```
User
  ↓
CloudFlare Network (CloudFlare's IP shown)
  ↓
[Encrypted Tunnel]
  ↓
Your Server (local IP hidden)
  ↓
[VPN - optional]
  ↓
Telegram (VPN IP shown)
```

**Your real home IP is never exposed!**

---

# Maintenance Commands

```bash
# Check tunnel status
sudo systemctl status cloudflared

# Restart tunnel
sudo systemctl restart cloudflared

# View tunnel logs
sudo journalctl -u cloudflared -f

# Test local server
curl http://localhost:3000/health

# Test public access
curl https://tgfiler.qzz.io/health

# Check your outbound IP
curl ifconfig.me

# ProtonVPN status (if using)
protonvpn-cli status

# Reconnect VPN
protonvpn-cli reconnect
```

---

# Security Checklist

After setup, verify:

- [ ] CloudFlare tunnel active
- [ ] Website loads via HTTPS
- [ ] DNS shows CloudFlare IP (not your home IP)
- [ ] Admin panel accessible at https://tgfiler.qzz.io/admin
- [ ] Bots work correctly
- [ ] Uploader can connect
- [ ] No ports forwarded on router (not needed with tunnel)
- [ ] VPN connected (if using)
- [ ] Outbound traffic goes through VPN IP (if using)

---

**Recommended Setup:** CloudFlare Tunnel only (VPN is optional for extra privacy)

**Time to Setup:** 15-30 minutes

**Technical Difficulty:** Easy (mostly copy-paste commands)

**Your IP Exposure:** None ✅
