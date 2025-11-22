# Complete Project Testing Guide
## All Phases - From Backend to Uploader

This guide tests the entire system end-to-end using the latest code.

---

# Prerequisites

## What You Need

- [ ] Linux machine for backend (Ubuntu 22.04 recommended) OR Windows with WSL
- [ ] Windows machine for testing uploader
- [ ] 2 Telegram bots (create via @BotFather)
- [ ] 2 private Telegram channels
- [ ] Your Telegram User ID (get from @userinfobot)
- [ ] Node.js 18+ installed
- [ ] Python 3.8+ installed (for uploader)

## Test Files Preparation

Create these test folders on your Windows machine:

```
test_files/
├── test_bot_1/
│   ├── Documents/
│   │   ├── file1.pdf (any PDF)
│   │   └── file2.txt (any text)
│   ├── Images/
│   │   ├── photo1.jpg
│   │   └── photo2.png
│   └── Videos/
│       └── video1.mp4
│
└── test_bot_2/
    ├── Books/
    │   ├── book1.pdf
    │   └── book2.pdf
    └── المجلد العربي/  (Arabic folder)
        └── ملف.txt
```

---

# Phase 1: Backend Server Testing

## Test 1.1: Installation

### On Linux/WSL:

```bash
# Navigate to project
cd telegram-bot-system/backend

# Install dependencies
npm install

# Verify all packages installed
npm list --depth=0
```

**Expected output:**
- No errors
- All packages from package.json listed

**Pass Criteria:** ✅ All dependencies installed successfully

---

## Test 1.2: Initial Server Start

```bash
# Set environment variables
export ADMIN_USERNAME="testadmin"
export ADMIN_PASSWORD="Test123456789!"
export PORT=3000

# Start server
npm start
```

**Expected output:**
```
✓ Storage directories initialized
✓ Configuration loaded
✓ Bots loaded and initialized
⚠️ Admin bot not configured. Notifications disabled.
✓ Admin bot ready

🚀 Server running on port 3000
📊 Active bots: 0
⏰ Started at: 2024-XX-XX...
```

**Pass Criteria:**
- ✅ Server starts without errors
- ✅ Directories auto-created in `data/`
- ✅ No crashes

---

## Test 1.3: Health Check

**In another terminal:**

```bash
curl http://localhost:3000/health
```

**Expected:**
```json
{"status":"ok","timestamp":"2024-XX-XX..."}
```

**Pass Criteria:** ✅ Returns 200 OK with JSON

---

## Test 1.4: Admin Panel Access

**In browser:**
```
http://localhost:3000/admin
```

**Expected:**
- Login page displays
- Username/password fields present
- "Login" button visible
- No console errors (F12)

**Pass Criteria:** ✅ Admin panel loads correctly

---

## Test 1.5: Admin Login

**On login page:**
1. Username: `testadmin`
2. Password: `Test123456789!`
3. Click Login

**Expected:**
- Redirects to dashboard
- Shows statistics (all 0s initially)
- Sidebar navigation works
- No errors

**Pass Criteria:** ✅ Can log in and see dashboard

---

## Test 1.6: Failed Login Protection

1. Enter wrong password 3 times
2. Try to login again

**Expected:**
- After 5 failed attempts: "Too many failed attempts"
- IP temporarily banned

**Pass Criteria:** ✅ Rate limiting works

---

## Test 1.7: Admin Panel Features

**Test each page:**

1. **Dashboard:**
   - [ ] Stats display (0 bots initially)
   - [ ] Recent activity empty

2. **Bot Management:**
   - [ ] Page loads
   - [ ] "No bots found" message
   - [ ] Filter dropdown works

3. **User Management:**
   - [ ] Banned users list empty
   - [ ] No errors

4. **Messaging:**
   - [ ] Bot dropdown empty
   - [ ] Form disabled (no bots yet)

5. **Settings:**
   - [ ] System settings load
   - [ ] Can change max JSON size
   - [ ] Can edit welcome message
   - [ ] Changes save successfully

6. **Security:**
   - [ ] Security log empty initially
   - [ ] No errors

7. **Backups:**
   - [ ] Backup history empty
   - [ ] "Create Backup" button works
   - [ ] Creates backup in `data/backups/`

**Pass Criteria:** ✅ All pages functional

---

# Phase 2: Bot Creation Testing

## Test 2.1: Create Test Bot via API

**In terminal (while server running):**

```bash
# Replace YOUR_BOT_TOKEN and @your_channel with real values
curl -X POST http://localhost:3000/api/upload \
  -H "Content-Type: application/json" \
  -d '{
    "botToken": "YOUR_BOT_TOKEN_HERE",
    "channelId": "@your_test_channel",
    "botUsername": "@your_test_bot",
    "metadata": {
      "subfolders": {
        "Test Folder": {
          "files": [],
          "subfolders": {
            "Subfolder 1": {
              "files": [],
              "subfolders": {}
            }
          }
        }
      },
      "files": []
    }
  }'
```

**Expected response:**
```json
{
  "success": true,
  "message": "Bot created successfully. Awaiting admin approval.",
  "botId": "abc123...",
  "status": "pending"
}
```

**Verify in admin panel:**
1. Refresh dashboard
2. Should show: 1 Total Bot, 1 Pending
3. Go to Bot Management
4. Bot listed with "pending" badge

**Pass Criteria:** ✅ Bot created and visible in admin panel

---

## Test 2.2: Test Pending Bot (Admin Only)

**Configure Admin User ID first:**

1. Admin panel → Settings
2. Enter your Telegram User ID
3. Save

**Test bot in Telegram:**
1. Open your test bot in Telegram
2. Send `/start`

**Expected (as admin):**
```
⚠️ ADMIN TEST MODE ⚠️

This bot is pending approval. You are testing as admin.

[Button: 📁 Test Folder]
```

**Expected (non-admin user):**
- No response (silently ignored)

**Pass Criteria:** ✅ Only admin can test pending bot

---

## Test 2.3: Owner Registration

**In Telegram (to your test bot):**
```
register
```

**Expected response:**
```
✅ Registration successful! Your bot has been submitted for review.

You will be notified once approved.
```

**Verify in admin panel:**
- Bot shows "Owner ID" in details
- Owner registered status: Yes

**Pass Criteria:** ✅ Owner registration captured

---

## Test 2.4: Bot Approval

**In admin panel:**
1. Go to Bot Management
2. Click on your pending bot
3. Click "Approve"
4. Confirm

**Expected:**
- Bot status changes to "approved"
- Success message
- Bot badge turns green

**Pass Criteria:** ✅ Bot approved successfully

---

## Test 2.5: Test Approved Bot (Public)

**Test from different Telegram account (non-admin):**

1. Search for your bot
2. Send `/start`

**Expected:**
```
👋 Welcome! Use the buttons below to navigate through folders and access files.

[Button: 📁 Test Folder]
```

3. Click "📁 Test Folder"
4. Should see: "📁 Subfolder 1"
5. Click subfolder
6. Should see: "📭 This folder is empty."

**Pass Criteria:** ✅ Bot works for all users after approval

---

## Test 2.6: Invalid Input Handling

**In bot:**
- Type random text (not a command)

**Expected:**
```
❌ Invalid input. Please use the buttons to navigate.
```

**Pass Criteria:** ✅ Invalid input handled correctly

---

## Test 2.7: Bot Disconnection

**In admin panel:**
1. Find approved bot
2. Click "Disconnect"

**Test in Telegram:**
- Send `/start`

**Expected:**
```
⛔ This bot is currently disconnected. Please contact the administrator.
```

**Pass Criteria:** ✅ Disconnected bot stops working

---

## Test 2.8: User Banning

**In admin panel:**
1. Go to Bot Management
2. Find bot with registered owner
3. Click "Ban Owner"
4. Enter reason: "Test ban"

**Expected:**
- User added to banned list
- All their bots disconnected

**Verify:**
- Go to User Management
- Banned user listed with reason

**Pass Criteria:** ✅ User banning works

---

# Phase 3: Windows Uploader Testing

## Test 3.1: Development Run

**On Windows machine:**

```powershell
cd uploader
pip install -r requirements.txt
python main.py
```

**Expected:**
- GUI window opens
- All fields visible
- No Python errors

**Pass Criteria:** ✅ Uploader GUI launches

---

## Test 3.2: Server Connection Check

**Before uploading, verify server URL:**

1. Open `uploader/config.py`
2. Check `SERVER_URL`
3. Should point to your server (e.g., `http://192.168.1.100:3000`)

**Test connection:**
- Start uploader
- Try to connect (will check automatically when uploading)

**Pass Criteria:** ✅ Config has correct server URL

---

## Test 3.3: Input Validation

**Test empty inputs:**
1. Don't fill anything
2. Click "Start Upload"

**Expected:**
- Validation error popup
- Lists all missing fields

**Test invalid token:**
1. Enter folder
2. Token: "invalid"
3. Channel: "@test"
4. Click Start

**Expected:**
- "Invalid bot token format"

**Pass Criteria:** ✅ Validation working

---

## Test 3.4: New Upload (Real Files)

**Prerequisites:**
- Create test bot #2 in Telegram
- Create private channel
- Add bot as admin
- Get bot token and channel ID

**Steps:**
1. Browse and select `test_bot_1/` folder
2. Paste bot token
3. Enter channel ID
4. Select "New Upload"
5. Click "Start Upload"

**Expected progress:**
```
Validating bot token...
✓ Bot validated: @your_bot
Checking channel access...
✓ Channel access confirmed
Scanning directory...
✓ Found 5 files in 3 folders (XX MB)
Uploading files to Telegram...
[1/5] Uploading: file1.pdf
[2/5] Uploading: file2.txt
...
✓ Uploaded 5 files
Sending metadata to server...
✓ Bot created successfully. Awaiting admin approval.
```

**Verify:**
1. Check Telegram channel - all files present
2. Check admin panel - new bot pending
3. Check bot works in Telegram

**Pass Criteria:** ✅ Full upload successful

---

## Test 3.5: Unicode/Arabic Support

**Steps:**
1. Select `test_bot_2/` (has Arabic folder)
2. Upload to new bot

**Expected:**
- Arabic folder name accepted
- Files upload successfully
- Bot displays Arabic correctly in Telegram

**Pass Criteria:** ✅ Unicode support working

---

## Test 3.6: Update Mode

**Modify test_bot_1:**
- Add new file: `Documents/file3.docx`
- Delete: `Images/photo2.png`
- Modify: Change content of `file1.pdf` (or replace it)

**Steps:**
1. Select modified test_bot_1
2. Same bot token/channel as Test 3.4
3. Select "Update Existing"
4. Click Start

**Expected:**
```
Update mode: Fetching existing metadata...
✓ Existing metadata retrieved
Changes detected: 2 added, 1 removed, 1 modified, 1 unchanged (X% change)
Removing 2 old files from channel...
✓ Old files removed
Uploading 3 files to Telegram...
[1/3] Uploading: file3.docx
[2/3] Uploading: file1.pdf
...
✓ Update successful
Change percentage: XX%
```

**Verify in channel:**
- Old photo2.png deleted
- New file3.docx present
- Modified file1.pdf updated

**Pass Criteria:** ✅ Update mode detects changes correctly

---

## Test 3.7: Large File Handling

**Create a 2.5GB file:**
```powershell
# PowerShell: Create 2.5GB file
fsutil file createnew large_file.bin 2684354560
```

**Steps:**
1. Add this file to test folder
2. Try to upload

**Expected:**
- File skipped with warning
- Other files upload normally
- Log shows: "Skipping 'large_file.bin': exceeds 2GB limit"

**Pass Criteria:** ✅ Large files skipped correctly

---

## Test 3.8: Cancel Upload

**Steps:**
1. Start upload with many files
2. Click "Cancel" after a few files
3. Confirm cancellation

**Expected:**
- Upload stops
- "Upload cancelled" message
- Already uploaded files remain
- Can start new upload

**Pass Criteria:** ✅ Cancellation works gracefully

---

## Test 3.9: Network Error Recovery

**Steps:**
1. Start upload
2. Disconnect WiFi briefly during upload
3. Reconnect

**Expected:**
- Retries failed files
- Shows "Network error" in log
- Continues after reconnect

**Pass Criteria:** ✅ Handles network issues

---

## Test 3.10: Build Executable

**Build the .exe:**

```powershell
.\build_uploader.ps1
```

**Expected:**
- Build completes
- `dist/FileUploader_v1.0.0.exe` created
- Size ~25-40 MB

**Test the executable:**
1. Double-click .exe
2. Complete an upload

**Pass Criteria:** ✅ Executable builds and runs

---

# Phase 4: Security Testing

## Test 4.1: SQL Injection Attempt

**Try to inject via API:**

```bash
curl -X POST http://localhost:3000/api/upload \
  -H "Content-Type: application/json" \
  -d '{
    "botToken": "123:ABC'; DROP TABLE bots;--",
    "channelId": "@test",
    "botUsername": "@test",
    "metadata": {}
  }'
```

**Expected:**
- Input sanitized
- No SQL injection (we use JSON, not SQL)
- Request safely rejected

**Pass Criteria:** ✅ Injection prevented

---

## Test 4.2: XSS Attempt

**Create bot with malicious folder name:**

```json
{
  "subfolders": {
    "<script>alert('XSS')</script>": {}
  }
}
```

**Expected:**
- Folder name validation fails
- Script tags sanitized
- Not stored or executed

**Pass Criteria:** ✅ XSS prevented

---

## Test 4.3: Path Traversal Attempt

**Try folder name: `../../etc/passwd`**

**Expected:**
- Validation rejects
- Error: "Path traversal characters not allowed"

**Pass Criteria:** ✅ Path traversal blocked

---

## Test 4.4: Rate Limiting

**Make 11 upload requests in 1 hour:**

```bash
for i in {1..11}; do
  curl -X POST http://localhost:3000/api/upload \
    -H "Content-Type: application/json" \
    -d '{"botToken":"test","channelId":"@test","botUsername":"@test","metadata":{}}';
  echo "\n";
done
```

**Expected:**
- First 10 succeed (or fail validation)
- 11th: "Upload rate limit exceeded"

**Pass Criteria:** ✅ Rate limiting works

---

## Test 4.5: Session Timeout

**In admin panel:**
1. Login
2. Wait 31 minutes (or change timeout to 1 min for testing)
3. Try to perform action

**Expected:**
- "Session expired" error
- Redirects to login

**Pass Criteria:** ✅ Session timeout works

---

# Phase 5: End-to-End Integration

## Test 5.1: Complete User Journey

**Simulate real user flow:**

1. **User creates bot:**
   - Create Telegram bot (@BotFather)
   - Create private channel
   - Add bot as admin

2. **User uploads files:**
   - Run FileUploader.exe
   - Select folder
   - Enter credentials
   - Upload successfully

3. **User registers:**
   - Open bot in Telegram
   - Send "register"
   - Get confirmation

4. **Admin approves:**
   - Check admin panel
   - See pending bot
   - Test bot personally
   - Approve bot

5. **Public uses bot:**
   - Different user opens bot
   - Navigates folders
   - Receives files

6. **User updates files:**
   - Modify local folder
   - Run uploader in update mode
   - Changes synced

**Pass Criteria:** ✅ Complete flow works end-to-end

---

## Test 5.2: Multiple Concurrent Bots

**Create 5 bots simultaneously:**
- Upload 5 different folders
- All with different tokens/channels

**Expected:**
- All uploads succeed
- No conflicts
- All bots work independently

**Pass Criteria:** ✅ Multi-bot handling works

---

## Test 5.3: Server Restart Persistence

**Steps:**
1. Create several bots
2. Stop server (Ctrl+C)
3. Restart server
4. Test bots in Telegram

**Expected:**
- All bots reload
- Bot states preserved
- All bots work correctly

**Pass Criteria:** ✅ Data persists across restarts

---

# Final Checklist

## Backend (Phase 1 & 2)

- [ ] Server starts without errors
- [ ] Health check responds
- [ ] Admin panel accessible
- [ ] Admin login works
- [ ] Bot creation via API works
- [ ] Bot approval workflow works
- [ ] Owner registration works
- [ ] Telegram bots respond correctly
- [ ] Folder navigation works
- [ ] File forwarding works
- [ ] Security features active
- [ ] Rate limiting works
- [ ] Session management works
- [ ] All admin panel pages functional
- [ ] Settings save correctly
- [ ] Backup system works

## Uploader (Phase 3)

- [ ] GUI launches
- [ ] Input validation works
- [ ] New upload succeeds
- [ ] Update mode detects changes
- [ ] Large files handled
- [ ] Unicode/Arabic support works
- [ ] Progress tracking accurate
- [ ] Cancel works
- [ ] Network errors handled
- [ ] Executable builds successfully

## Security & Integration

- [ ] Injection attempts blocked
- [ ] XSS prevented
- [ ] Path traversal blocked
- [ ] Rate limiting enforced
- [ ] Session timeout works
- [ ] End-to-end flow complete
- [ ] Multiple bots work
- [ ] Data persists across restarts

---

# Test Results Template

Copy this to document your testing:

```
# Test Results - [Date]

## Phase 1: Backend Server
- Test 1.1: Installation - [PASS/FAIL] - Notes:
- Test 1.2: Server Start - [PASS/FAIL] - Notes:
- Test 1.3: Health Check - [PASS/FAIL] - Notes:
...

## Phase 2: Bot Creation
- Test 2.1: Create Bot - [PASS/FAIL] - Notes:
...

## Phase 3: Uploader
- Test 3.1: Development Run - [PASS/FAIL] - Notes:
...

## Phase 4: Security
- Test 4.1: SQL Injection - [PASS/FAIL] - Notes:
...

## Phase 5: Integration
- Test 5.1: User Journey - [PASS/FAIL] - Notes:
...

## Overall Status: [PASS/FAIL]

Issues Found:
1. [List any issues]

Notes:
[Any additional observations]
```

---

# Troubleshooting Common Issues

## Server won't start
- Check Node.js version: `node --version` (need 18+)
- Delete `node_modules` and reinstall: `npm install`
- Check port 3000 not in use: `lsof -i :3000`

## Admin panel won't load
- Check `public/` folder exists
- Verify files: `admin-panel.html`, `admin-panel.js`
- Check browser console for errors

## Uploader fails to connect
- Verify `config.py` has correct SERVER_URL
- Check server is running: `curl http://SERVER_IP:3000/health`
- Check firewall allows port 3000

## Bot doesn't respond
- Verify bot token is correct
- Check bot is admin in channel
- Review server console logs
- Check bot status in admin panel

---

**Total Test Duration:** ~2-3 hours for complete testing

**Test Environment:**
- Backend: Linux/Ubuntu 22.04 or Windows WSL
- Uploader: Windows 10/11
- Network: Local network for initial testing

Good luck with testing! 🚀
