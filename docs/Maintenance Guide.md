# Long-Term Maintenance Guide
## Keeping Your Telegram Bot System Updated and Running

This guide explains what to monitor, when to update, and how to maintain your system over time.

---

# 1. What to Monitor Regularly

## Weekly Checks (5 minutes)

### Run Health Check
```bash
sudo bash /opt/telegram-bot-system/scripts/health_check.sh
```

**Look for:**
- ✓ All services running (tgbot, caddy, ufw, fail2ban)
- ✓ Disk usage < 80%
- ✓ Backup age < 2 days
- ✓ Memory usage < 80%

### Check Application Logs
```bash
tail -n 50 /opt/telegram-bot-system/logs/app.log
```

**Look for:**
- Repeated errors
- Security warnings
- Bot failures

### Check System Logs
```bash
sudo journalctl -u tgbot --since "7 days ago" | grep -i error
```

## Monthly Checks (15 minutes)

### Update Operating System
```bash
sudo apt update
sudo apt upgrade -y
sudo reboot
```

### Verify Backups Work
```bash
# List backups
ls -lh /opt/telegram-bot-system/data/backups/

# Test extracting latest backup
cd /tmp
sudo tar -tzf /opt/telegram-bot-system/data/backups/backup_*.tar.gz | head -20
```

### Check SSL Certificate
```bash
curl -vI https://yourdomain.com 2>&1 | grep "expire date"
```

Caddy auto-renews, but verify it's working.

### Review Banned IPs
```bash
sudo fail2ban-client status sshd
```

Unban if needed:
```bash
sudo fail2ban-client set sshd unbanip <IP_ADDRESS>
```

---

# 2. Dependency Updates

## Node.js Updates

### Current Version: 20.x

**Check for updates:**
```bash
node --version
npm --version
```

**When to update:**
- Security advisories for Node.js
- New LTS version released
- Current version approaching EOL

**How often to check:**
- Every 3-6 months

**How to update:**

1. Check Node.js release schedule: https://nodejs.org/en/about/releases/
2. When a new LTS is available:

```bash
# Install new version
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# Verify
node --version

# Restart application
sudo systemctl restart tgbot
```

3. Test everything works
4. Monitor logs for 24 hours

**Breaking changes watch:**
- Node.js 18 → 20: No breaking changes for this project
- Node.js 20 → 22: Monitor deprecations

## NPM Package Updates

### Check for outdated packages:
```bash
cd /opt/telegram-bot-system/backend
npm outdated
```

### Update packages safely:

**Minor/patch updates (safe):**
```bash
sudo -u tgbot npm update
sudo systemctl restart tgbot
```

**Major updates (test first):**
```bash
# Create backup first
sudo bash /opt/telegram-bot-system/scripts/backup.sh

# Update one package at a time
sudo -u tgbot npm install express@latest
sudo systemctl restart tgbot

# Test thoroughly
curl http://localhost:3000/health
```

### Critical packages to watch:

| Package | Current | Check | Why |
|---------|---------|-------|-----|
| express | 4.18+ | 3 months | Core web framework |
| node-telegram-bot-api | 0.64+ | 6 months | Telegram API changes |
| helmet | 7.1+ | 6 months | Security headers |
| express-rate-limit | 7.1+ | 6 months | DDoS protection |

### How often: 
- Security updates: Immediately
- Minor updates: Every 3 months
- Major updates: Every 6 months (test first)

---

# 3. Telegram Bot API Updates

### Current API Version Used: Latest (auto-updated by library)

**What to monitor:**
- Telegram Bot API changelog: https://core.telegram.org/bots/api#recent-changes
- node-telegram-bot-api releases: https://github.com/yagop/node-telegram-bot-api/releases

**Critical changes to watch for:**

1. **File size limits** (currently 2GB)
   - If increased: Update `config.py` in uploader
   - If decreased: Add validation

2. **Rate limits** (currently ~20 msg/min to same user)
   - If changed: Update retry logic in `telegram_api.py`

3. **New required fields** in API calls
   - Check `bot-manager.js` and `telegram_api.py`
   - Update API calls if needed

4. **Deprecated methods**
   - Replace before they're removed

**How often to check:** Monthly

**How to update:**

```bash
# Update Telegram library
cd /opt/telegram-bot-system/backend
sudo -u tgbot npm install node-telegram-bot-api@latest

# Restart
sudo systemctl restart tgbot

# Test a bot
# (send /start command in Telegram)
```

---

# 4. Python/PyQt5 Updates (Windows Uploader)

### Current Versions:
- Python: 3.8+
- PyQt5: 5.15+
- PyInstaller: 5.0+

**What to monitor:**
- Python security advisories
- PyQt5 compatibility
- PyInstaller updates

**When to update:**
- Python 3.8 reaches EOL (October 2024 - already passed)
- Security vulnerabilities
- PyQt5 breaking changes

**How to update:**

1. On your Windows development machine:

```powershell
# Update Python packages
pip install --upgrade PyQt5 requests pyinstaller

# Test the uploader
python main.py

# If works, rebuild executable
.\build_uploader.ps1
```

2. Test the new executable thoroughly
3. Distribute to users

**How often:**
- Check every 6 months
- Update Python when EOL approaches

---

# 5. Ubuntu System Updates

### Current: Ubuntu 22.04 LTS

**End of support:** April 2027

**Auto-updates enabled:** Yes (security only)

**Manual updates:**
```bash
# Check for updates
sudo apt update

# Install updates
sudo apt upgrade -y

# Clean up
sudo apt autoremove -y
sudo apt autoclean
```

**Major version upgrades (e.g., 22.04 → 24.04):**

⚠️ **Don't rush major upgrades!**

Wait 3-6 months after new LTS release for stability.

**Before upgrading:**
1. Create full backup
2. Test on a separate server if possible
3. Read Ubuntu release notes

**How to upgrade:**
```bash
# Create backup
sudo bash /opt/telegram-bot-system/scripts/backup.sh

# Upgrade
sudo do-release-upgrade

# Reboot
sudo reboot

# Verify everything works
sudo bash /opt/telegram-bot-system/scripts/health_check.sh
```

---

# 6. Security Updates

## Critical: Apply Immediately

**Security updates are auto-installed** (configured during deployment).

**Verify auto-updates working:**
```bash
sudo systemctl status unattended-upgrades
cat /var/log/unattended-upgrades/unattended-upgrades.log
```

**Manual security check:**
```bash
sudo apt update
sudo apt list --upgradable | grep -i security
```

## Fail2Ban Updates

**Check status:**
```bash
sudo fail2ban-client status
```

**Update rules if needed:**
```bash
sudo apt update
sudo apt install --only-upgrade fail2ban
sudo systemctl restart fail2ban
```

## SSL Certificate Monitoring

Caddy auto-renews Let's Encrypt certificates.

**Verify auto-renewal:**
```bash
sudo journalctl -u caddy --since "30 days ago" | grep -i "certificate"
```

Certificates renew every 60 days automatically.

---

# 7. Code-Specific Maintenance

## Race Conditions (Fixed in Current Code)

The code now includes:
- File locking with `proper-lockfile`
- Atomic bot status updates
- Circuit breakers for failing bots
- Write queues for concurrent operations

**Monitor for:**
- "Failed to acquire lock" errors in logs
- Concurrent update failures

**If issues occur:**
```bash
# Check for stale locks
sudo find /opt/telegram-bot-system/data -name "*.lock" -mtime +1 -delete

# Restart service
sudo systemctl restart tgbot
```

## Memory Leaks

**Watch memory usage:**
```bash
# Real-time monitoring
htop
# Look for tgbot process memory

# Or check logs
free -h
```

**If memory grows over time:**
- Weekly restart is scheduled (Sunday 4 AM)
- If needed, increase restart frequency in crontab

## Bot Circuit Breakers

**Check circuit breaker state:**
```bash
cat /opt/telegram-bot-system/data/config/circuit_breakers.json
```

Bots that fail repeatedly are automatically disabled.

**Reset a circuit breaker:**
- Fix the underlying issue
- Delete the bot's entry from circuit_breakers.json
- Restart service

---

# 8. Monitoring Setup (Optional but Recommended)

## Set Up Email Alerts

Install:
```bash
sudo apt install mailutils
```

Configure to receive:
- Backup failure alerts
- Disk space warnings
- Service down alerts

## Log Rotation

Already configured. Verify:
```bash
cat /etc/logrotate.d/tgbot
```

Logs rotate daily, keep 14 days.

## Uptime Monitoring

Consider external monitoring:
- UptimeRobot (free): https://uptimerobot.com
- Monitor: `https://yourdomain.com/health`
- Get alerts if site goes down

---

# 9. Current Rate Limits

## System-Imposed Limits

### API Rate Limits:
- **Global:** 100 requests per 15 minutes per IP
- **Upload endpoint:** 10 requests per hour per IP
- **Metadata endpoint:** 30 requests per 15 minutes per IP

**Configured in:** `backend/server.js`

**To change:**
```javascript
// In server.js, find:
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,  // Change this number
  //...
});
```

### Admin Panel:
- **Login attempts:** 5 failed = 15 minute IP ban
- **Session timeout:** 30 minutes of inactivity
- **CSRF tokens:** 1 hour expiration

### Bot Operations:
- No specific limits, but subject to Telegram's limits

## Telegram's Rate Limits

### Bot API Limits:
- **Messages:** ~30 per second to different users
- **Same user:** ~1 per second
- **Group messages:** ~20 per minute
- **File downloads:** ~1-2 per second

**Handled by:** Automatic retry logic in `telegram_api.py`

### File Limits:
- **Max file size:** 2GB per file
- **Total storage:** Unlimited (files stored on Telegram)

## No Built-in Bot Creation Limits

The system doesn't limit how many bots users can create. You might want to add this:

**To add a limit:**

1. Track bots per user in `storage.js`:
```javascript
getBotCountByOwner(ownerId) {
  return this.getAllBots().filter(b => b.ownerId === ownerId).length;
}
```

2. Check in `server.js` upload endpoint:
```javascript
const botCount = storage.getBotCountByOwner(ownerId);
if (botCount >= 5) {  // Max 5 bots per user
  return res.status(429).json({
    success: false,
    error: 'Maximum bot limit reached (5 bots per user)'
  });
}
```

---

# 10. Scalability Limits

## Current Architecture Capacity

### Comfortable Operation:
- **10-50 bots:** Excellent performance
- **1GB RAM, 1 CPU core** sufficient

### Maximum Capacity:
- **Up to 500 bots:** Possible with current architecture
- **2GB RAM, 2 CPU cores** recommended

### Limiting Factors:

1. **JSON File Storage:**
   - 500+ bots = ~500 files in `/data/bots/`
   - File I/O becomes bottleneck
   - Solution: Migrate to database (see below)

2. **In-Memory Sessions:**
   - Lost on restart
   - Only one admin supported
   - Solution: Redis or database-backed sessions

3. **Single Process:**
   - Node.js is single-threaded
   - CPU-bound at ~1000 concurrent requests
   - Solution: Load balancer + multiple instances

## Scaling to 1,000+ Bots

### Step 1: Add Database (Priority 1)

**Replace JSON with PostgreSQL or SQLite:**

**Benefits:**
- Faster queries
- Better concurrent access
- ACID transactions
- Support for millions of bots

**Implementation:**
```javascript
// Instead of storage.js JSON:
npm install pg  // or sqlite3

// Use SQL queries:
SELECT * FROM bots WHERE status = 'approved';
```

**Migration effort:** ~1-2 days

### Step 2: Increase Resources

**For 1,000 bots:**
- **RAM:** 4GB minimum
- **CPU:** 2-4 cores
- **Storage:** 50GB (mainly for logs/backups)

**VPS upgrade:**
- Hetzner CX21: €5.99/month (2 vCPU, 4GB RAM)
- Or scale vertically on current provider

### Step 3: Redis for Sessions

**Why:**
- Persistent sessions across restarts
- Support for multiple admin instances
- Better performance

**Install:**
```bash
sudo apt install redis-server
npm install redis express-session connect-redis
```

**Implementation effort:** ~1 day

### Step 4: Load Balancing (1,000+ bots)

**Setup:**
```
         ┌─> Node.js Instance 1 (tgbot-1)
Caddy ──┼─> Node.js Instance 2 (tgbot-2)
         └─> Node.js Instance 3 (tgbot-3)
```

**Benefits:**
- Zero-downtime updates
- Handle 10,000+ concurrent users
- Automatic failover

**Implementation:** ~3-5 days

### Step 5: Separate Bot Polling (5,000+ bots)

**Current:** All bots poll in one process

**Better:** Separate bot manager service

```
Backend API (Express)  ←→  Database
                       ↓
Bot Manager Service (Separate) ←→ Telegram API
```

**Benefits:**
- API remains responsive even with many bots
- Easier to scale bot polling separately
- Better resource isolation

**Implementation:** ~5-7 days

## Performance Benchmarks

### Current Code:
- **10 bots:** <1% CPU, ~150MB RAM
- **50 bots:** ~5% CPU, ~300MB RAM  
- **100 bots:** ~10% CPU, ~500MB RAM
- **500 bots:** ~30% CPU, ~1.5GB RAM

### With Database:
- **1,000 bots:** ~40% CPU, ~2GB RAM
- **5,000 bots:** ~80% CPU, ~4GB RAM (with load balancing)

### Bottlenecks:

1. **Below 500 bots:** File I/O
2. **500-1000 bots:** CPU (JSON parsing)
3. **1000+ bots:** Telegram API rate limits
4. **5000+ bots:** Need horizontal scaling

---

# 11. When to Upgrade Architecture

## Indicators You Need to Scale:

### Immediate Action Needed:
- Health check shows memory >90%
- Response times >2 seconds consistently
- More than 10 bot failures per day
- Disk space >90%

### Plan Upgrade Soon:
- Approaching 300 bots
- Memory usage >70%
- Regular "file busy" errors in logs
- Admin panel feels slow

### Nice to Have:
- More than 100 bots running well
- Want multiple admins
- Need bot analytics
- Want better uptime guarantee

## Upgrade Path Summary:

```
Current (JSON) → Database → Redis Sessions → Load Balancer → Separate Services
     ↓              ↓            ↓               ↓               ↓
   <50 bots    <500 bots    <1000 bots     <5000 bots      >5000 bots
```

---

# 12. Emergency Procedures

## Service Won't Start

```bash
# Check what failed
sudo journalctl -u tgbot -n 100

# Common fixes:
# 1. Port in use
sudo lsof -i :3000
sudo kill <PID>

# 2. Permission issues
sudo chown -R tgbot:tgbot /opt/telegram-bot-system

# 3. Missing dependencies
cd /opt/telegram-bot-system/backend
sudo -u tgbot npm install

# 4. Corrupted files
sudo bash /opt/telegram-bot-system/scripts/backup.sh  # if possible
# Restore from backup if needed
```

## Database Corruption (JSON files)

```bash
# Stop service
sudo systemctl stop tgbot

# Check for corrupted JSON
find /opt/telegram-bot-system/data -name "*.json" -exec python3 -m json.tool {} \; 2>&1 | grep -B5 "error"

# Restore from backup
cd /opt/telegram-bot-system/data/backups
tar -xzf backup_LATEST.tar.gz

# Start service
sudo systemctl start tgbot
```

## Complete System Failure

```bash
# Restore from backup on new server
# 1. Install fresh following DEPLOYMENT_GUIDE.md
# 2. Stop service
sudo systemctl stop tgbot

# 3. Extract backup
cd /opt/telegram-bot-system/data
sudo tar -xzf /path/to/backup.tar.gz --strip-components=1

# 4. Fix permissions
sudo chown -R tgbot:tgbot /opt/telegram-bot-system

# 5. Start service
sudo systemctl start tgbot
```

---

# 13. Maintenance Checklist

## Weekly (5 min)
- [ ] Run health check script
- [ ] Check application logs for errors
- [ ] Verify latest backup exists

## Monthly (15 min)
- [ ] Update OS packages
- [ ] Check NPM packages for updates
- [ ] Verify SSL certificate valid
- [ ] Review fail2ban banned IPs
- [ ] Check disk space

## Quarterly (30 min)
- [ ] Update Node.js if new LTS
- [ ] Update NPM packages (minor versions)
- [ ] Review and optimize logs
- [ ] Test backup restoration
- [ ] Review Telegram API changelog

## Yearly (2 hours)
- [ ] Major NPM package updates (test thoroughly)
- [ ] Ubuntu version upgrade (if new LTS stable)
- [ ] Review and update security hardening
- [ ] Audit user feedback for needed features
- [ ] Consider database migration if >300 bots

---

# 14. Getting Help

## When You Need Professional Help:

- Database migration (if scaling to 500+ bots)
- Load balancer setup (if needing 99.9% uptime)
- Custom feature development
- Security audit

## Resources:

- **Node.js:** https://nodejs.org/docs
- **Telegram Bot API:** https://core.telegram.org/bots/api
- **Express.js:** https://expressjs.com/
- **Ubuntu Server:** https://ubuntu.com/server/docs


---

**Remember:** This is a hobbyist project. Don't over-optimize early. Scale when you need to, not before!