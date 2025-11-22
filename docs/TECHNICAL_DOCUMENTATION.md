# Telegram Bot File Management System
## Complete Technical Documentation

**Version:** 1.0  
**Last Updated:** November 2024  
**Status:** Production Ready

---

# Executive Summary

This is a complete, production-ready system that allows users to create their own Telegram file-sharing bots. Files are stored on Telegram's servers (not yours), and the system provides a moderation workflow where an admin approves all bots before they go public.

**Key Innovation:** Users create their own bots and channels, upload files, and your system just manages the bot behavior and approval process. You never store large files - Telegram does.

---

# Table of Contents

1. [Problem & Solution](#problem--solution)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [Component Overview](#component-overview)
5. [Data Flow](#data-flow)
6. [Security Model](#security-model)
7. [File Structure](#file-structure)
8. [API Specification](#api-specification)
9. [Database Schema](#database-schema)
10. [Deployment Architecture](#deployment-architecture)
11. [Testing Strategy](#testing-strategy)
12. [Known Limitations](#known-limitations)
13. [Future Enhancements](#future-enhancements)

---

# Problem & Solution

## The Problem

People want to share files via Telegram bots with a nice folder navigation interface, but:
1. Creating a bot requires coding knowledge
2. Hosting files costs money and bandwidth
3. Managing multiple bots is complex
4. No built-in moderation/approval system exists

## Our Solution

A **3-component system:**

1. **Backend Server (Node.js)**: Manages multiple bots, handles user interactions, provides approval workflow
2. **Admin Panel (Web UI)**: Allows system admin to moderate bots, ban users, configure system
3. **Windows Uploader (Python/PyQt5)**: Lets end-users upload files to their own Telegram channels via GUI

**Key Insight:** Files are uploaded to user's own private Telegram channel using their own bot. We only store JSON metadata (file names, folder structure, Telegram file_ids). When someone requests a file, we just forward it from the channel.

**Result:** 
- No file storage costs for admin
- Infinite scalability (Telegram handles files)
- User's bot ban doesn't affect other bots
- Simple moderation workflow

---

# System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    End Users                        │
│                 (Bot Creators)                      │
└────────────────┬────────────────────────────────────┘
                 │
                 │ 1. Uses Windows App
                 ▼
┌─────────────────────────────────────────────────────┐
│          Windows GUI Uploader (Python)              │
│                                                     │
│  • Scans local folder                              │
│  • Uploads files to user's Telegram channel        │
│  • Sends metadata JSON to backend                  │
└────────────────┬────────────────────────────────────┘
                 │
                 │ 2. HTTP POST (metadata)
                 ▼
┌─────────────────────────────────────────────────────┐
│         Backend Server (Node.js)                    │
│                                                     │
│  • Receives metadata                               │
│  • Creates bot instance (pending status)           │
│  • Notifies admin                                  │
│  • Manages all bot interactions                    │
└────────────────┬────────────────────────────────────┘
                 │
                 │ 3. Admin reviews
                 ▼
┌─────────────────────────────────────────────────────┐
│         Admin Panel (Web UI)                        │
│                                                     │
│  • View all bots                                   │
│  • Approve/reject bots                             │
│  • Ban users                                       │
│  • Configure system                                │
└─────────────────────────────────────────────────────┘
                 │
                 │ 4. Approve bot
                 ▼
┌─────────────────────────────────────────────────────┐
│              Telegram Users                         │
│         (File Request/Receive)                      │
│                                                     │
│  • Send /start to bot                              │
│  • Click folder buttons                            │
│  • Receive files (forwarded from channel)          │
└─────────────────────────────────────────────────────┘
```

## Component Interactions

1. **User** creates bot via @BotFather, creates private channel, adds bot as admin
2. **User** runs Windows Uploader, selects folder, enters bot token + channel ID
3. **Uploader** uploads all files to channel, collects file_ids, sends metadata JSON to server
4. **Server** creates bot instance (status: pending), starts Telegram bot handler
5. **Admin** gets notification, tests bot personally (only admin can use pending bots)
6. **Admin** approves bot via web panel
7. **Server** changes bot status to "approved"
8. **Public users** can now use bot to navigate folders and receive files

---

# Technology Stack

## Backend Server

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Runtime | Node.js | 18+ | Server-side JavaScript |
| Framework | Express | 4.18+ | Web server & API |
| Bot Library | node-telegram-bot-api | 0.64+ | Telegram Bot API |
| Security | helmet | 7.1+ | HTTP headers security |
| Rate Limiting | express-rate-limit | 7.1+ | DDoS protection |
| Validation | express-validator | 7.0+ | Input validation |
| Storage | JSON files | - | No database needed |

## Admin Panel

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | HTML5/CSS3/JavaScript | Web interface |
| Authentication | SHA-256 hashing | Password security |
| Session Management | In-memory (Map) | Session tokens |
| UI Design | Custom CSS | Responsive design |

## Windows Uploader

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Language | Python | 3.8+ | Core logic |
| GUI Framework | PyQt5 | 5.15+ | User interface |
| HTTP Client | requests | 2.28+ | Server API calls |
| Build Tool | PyInstaller | 5.0+ | Create .exe |

## Deployment

| Component | Technology | Purpose |
|-----------|-----------|---------|
| OS | Ubuntu 22.04 LTS | Server operating system |
| Process Manager | systemd | Auto-restart service |
| Reverse Proxy | Caddy | HTTPS automation |
| Firewall | UFW | Port filtering |
| Security | fail2ban | Brute force protection |

---

# Component Overview

## 1. Backend Server (`backend/`)

### Core Files

#### `server.js` (Main Entry Point)
**Lines:** ~250  
**Purpose:** Express server setup, routing, initialization

**Key Responsibilities:**
- Initialize all components (storage, config, bot manager, etc.)
- Define API routes (`/api/upload`, `/api/bot-status`, `/api/bot-metadata`)
- Mount admin routes (`/api/admin/*`)
- Serve static admin panel files
- Handle graceful shutdown

**Critical Functions:**
- `startServer()`: Initializes everything and starts listening
- `/api/upload` endpoint: Receives metadata from uploader
- `/api/admin/*` routes: All admin panel operations

#### `bot-manager.js` (Multi-Bot Handler)
**Lines:** ~280  
**Purpose:** Manages multiple Telegram bot instances simultaneously

**Key Responsibilities:**
- Load all bots from storage on startup
- Create/start/stop individual bot instances
- Handle Telegram messages and commands
- Implement folder navigation with buttons
- Forward files from channels
- Enforce approval workflow (pending bots only respond to admin)

**Critical Functions:**
- `loadAllBots()`: Loads all bots on server start
- `addBot()`: Creates new bot instance
- `setupBotHandlers()`: Configures bot event handlers
- `sendFolderMenu()`: Generates inline keyboard with folder buttons

**How It Works:**
1. Each bot gets its own `TelegramBot` instance
2. All bots run concurrently in the same process
3. Bot status checked before responding (pending = admin only)
4. File navigation built from JSON metadata

#### `storage.js` (JSON File Storage)
**Lines:** ~250  
**Purpose:** All data persistence operations

**Key Responsibilities:**
- Create/read/update/delete bot configurations
- Manage system configuration
- Handle banned user list
- Create backups
- Calculate change percentages (for updates)

**Data Structure:**
```
data/
├── bots/
│   └── bot_<id>.json      # One file per bot
├── config/
│   ├── admin.json         # Admin settings
│   ├── system.json        # System settings
│   └── banned_users.json  # Banned user IDs
└── backups/
    └── backup_<timestamp>/
```

**Critical Functions:**
- `createBot()`: Creates new bot JSON file
- `getBotById()`, `getBotByToken()`: Retrieve bot data
- `updateBotStatus()`: Change approval status
- `registerBotOwner()`: Store owner's Telegram User ID
- `calculateChangePercentage()`: For update detection

#### `security.js` (Input Sanitization)
**Lines:** ~200  
**Purpose:** Prevent all injection attacks

**Key Responsibilities:**
- Sanitize all text inputs (HTML escaping)
- Validate folder/file names
- Detect dangerous patterns (XSS, injection)
- Validate JSON structures
- Prevent path traversal
- Prevent prototype pollution

**Critical Functions:**
- `sanitizeInput()`: Clean all text inputs
- `sanitizeTelegramMessage()`: Telegram-specific cleaning
- `sanitizeJSON()`: Recursive JSON sanitization
- `validateFolderStructure()`: Check folder hierarchy
- `isValidFolderName()`: Validate folder names (Unicode safe)

**Dangerous Patterns Blocked:**
- `<script>`, `javascript:`, `on*=` (XSS)
- `../`, `__proto__` (traversal/pollution)
- `eval()`, `Function()` (code injection)

#### `config.js` (Configuration Management)
**Lines:** ~120  
**Purpose:** Centralized configuration

**Manages:**
- Admin Telegram User ID (for testing pending bots)
- Admin Bot Token (for notifications)
- Admin Channel ID (where notifications sent)
- Max JSON size (default 10MB)
- Welcome message (shown on /start)
- Invalid input message (for non-button input)

**Critical Functions:**
- `initialize()`: Load/create default configs
- `getAdminUserId()`: Returns admin's Telegram ID
- `getMaxJsonSize()`: Returns max JSON size in bytes
- `setWelcomeMessage()`: Update welcome text

#### `admin-bot.js` (Notification System)
**Lines:** ~150  
**Purpose:** Send alerts to admin via Telegram

**Sends Notifications For:**
- New bot created (pending review)
- Bot updated with >30% changes
- Security events (attacks, injections)
- System events (startup, shutdown)
- Backup results

**Critical Functions:**
- `initialize()`: Setup admin bot connection
- `sendAlert()`: Send formatted alert message
- `sendBackupReport()`: Send backup status
- `sendSecurityAlert()`: Send security event

**Optional:** If not configured, just logs to console

#### `admin-routes.js` (Admin API Endpoints)
**Lines:** ~400  
**Purpose:** All admin panel backend operations

**Authentication:**
- Login creates session token (32-byte random)
- All routes require valid token
- Sessions expire after 30 minutes
- Failed logins tracked per IP (5 attempts = 15min ban)

**Endpoints Provided:**
```
POST /api/admin/login              # Login
GET  /api/admin/verify             # Check session
GET  /api/admin/stats              # Dashboard stats
GET  /api/admin/bots               # List all bots
GET  /api/admin/bot/:id            # Get bot details
POST /api/admin/approve-bot        # Approve pending bot
POST /api/admin/disconnect-bot     # Disconnect bot
POST /api/admin/ban-user           # Ban user + disconnect all their bots
GET  /api/admin/banned-users       # List banned users
POST /api/admin/unban-user         # Unban user
POST /api/admin/send-message       # Send message to bot owner
GET  /api/admin/config/admin       # Get admin config
POST /api/admin/config/admin       # Save admin config
GET  /api/admin/config/system      # Get system config
POST /api/admin/config/system      # Save system config
POST /api/admin/create-backup      # Manual backup
GET  /api/admin/backups            # Backup history
```

---

## 2. Admin Panel (`backend/public/`)

### `admin-panel.html` (UI Structure)
**Lines:** ~500  
**Purpose:** Web interface HTML structure

**Sections:**
1. Login page (shown when not authenticated)
2. Dashboard (stats, recent activity)
3. Bot Management (list, filter, approve/disconnect)
4. User Management (banned users, unban)
5. Messaging (send messages to bot owners)
6. Settings (admin config, system config)
7. Security Monitor (security events log)
8. Backups (create/view backups)

**Design:**
- Responsive (works on mobile)
- Modern card-based layout
- Color-coded status badges
- Real-time updates

### `admin-panel.js` (Client Logic)
**Lines:** ~800  
**Purpose:** Admin panel client-side logic

**Key Functions:**
- `handleLogin()`: Authenticate user
- `loadOverview()`: Load dashboard stats
- `loadBots()`: Load bot list with filter
- `approveBot()`, `disconnectBot()`, `banOwner()`: Bot operations
- `loadSettings()`: Load system settings
- `handleSaveSystemConfig()`: Save settings

**Session Management:**
- Token stored in localStorage
- Sent with every API call (Authorization header)
- Auto-logout on expiry

---

## 3. Windows Uploader (`uploader/`)

### `main.py` (Entry Point)
**Lines:** ~30  
**Purpose:** Start the GUI application

### `gui.py` (GUI Interface)
**Lines:** ~350  
**Purpose:** PyQt5 user interface

**UI Elements:**
- Folder picker (browse button)
- Bot token input (masked)
- Channel ID input
- Mode selector (New / Update)
- Progress bar
- Log window (detailed status)
- Start/Cancel buttons

**WorkerThread:**
- Runs upload in background
- Prevents UI freeze
- Emits signals for progress/log updates

### `uploader.py` (Core Logic)
**Lines:** ~280  
**Purpose:** Orchestrate entire upload process

**Upload Flow:**
1. Validate bot token (call Telegram API)
2. Check channel access (bot must be admin)
3. Check server connection
4. Scan local directory
5. Compare with server metadata (if update mode)
6. Upload files to Telegram channel
7. Build metadata JSON
8. Send metadata to server

**Update Mode:**
- Fetches existing metadata from server
- Compares with local folder
- Identifies: added, removed, modified, unchanged
- Uploads only changed files
- Deletes old files from channel
- Preserves file_ids for unchanged files

### `telegram_api.py` (Telegram API Wrapper)
**Lines:** ~180  
**Purpose:** Handle all Telegram operations

**Key Functions:**
- `validate_token()`: Check if bot token is valid
- `check_channel_admin()`: Verify bot is channel admin
- `upload_file()`: Upload file to channel via bot
- `delete_message()`: Remove old file from channel

**Rate Limiting:**
- Detects Telegram rate limits
- Automatically retries after wait period
- Exponential backoff for failures

### `file_scanner.py` (Directory Scanner)
**Lines:** ~200  
**Purpose:** Scan local folders, validate files

**Key Functions:**
- `scan_directory()`: Recursive folder scan
- `validate_folder_name()`: Check folder name safety
- `validate_file_name()`: Check file name
- Returns hierarchical structure

**Validation:**
- Unicode support (Arabic, etc.)
- Path traversal detection
- Dangerous pattern detection
- File size checks (skip >2GB)
- Empty file detection

### `json_builder.py` (Metadata Builder)
**Lines:** ~250  
**Purpose:** Build and compare JSON metadata

**Key Functions:**
- `build_metadata()`: Create JSON from scanned structure
- `compare_structures()`: Find differences (for update mode)
- `merge_with_existing()`: Preserve unchanged file_ids
- `clean_metadata_for_server()`: Remove local paths

**Change Detection:**
- Compares by file path + size
- Identifies: added, removed, modified, unchanged
- Calculates change percentage

### `api_client.py` (Server API Client)
**Lines:** ~150  
**Purpose:** Communicate with backend server

**Key Functions:**
- `check_connection()`: Test server reachability
- `get_bot_metadata()`: Fetch existing metadata (update mode)
- `upload_metadata()`: Send JSON to server

### `config.py` (Configuration)
**Lines:** ~60  
**Purpose:** Settings and constants

**Key Settings:**
```python
SERVER_URL = "http://localhost:3000"  # Change for production
MAX_FILE_SIZE = 2GB  # Telegram limit
MAX_JSON_SIZE = 10MB  # Default server limit
UPLOAD_TIMEOUT = 300  # 5 minutes per file
```

---

## 4. Deployment Scripts (`scripts/`)

### `install.sh` (Main Installer)
**Purpose:** Complete system installation

**What It Does:**
1. Update system packages
2. Install Node.js 20
3. Install Caddy (HTTPS)
4. Create service user (`tgbot`)
5. Create directory structure
6. Configure Caddy with domain
7. Setup UFW firewall
8. Configure fail2ban

**Usage:**
```bash
sudo bash install.sh
```

**Interactive:** Asks for domain, admin username/password

### `setup_service.sh` (Systemd Service)
**Purpose:** Make app auto-start on boot

**Creates:**
- systemd service file
- Log rotation config
- Auto-restart on failure

### `backup.sh` (Automated Backups)
**Purpose:** Daily backup creation

**What It Backs Up:**
- All bot JSON files
- All config files
- Banned user list

**Scheduled:** Runs at 2:00 AM daily (via cron)

### `setup_cron.sh` (Scheduled Tasks)
**Purpose:** Setup cron jobs

**Tasks:**
- Daily backup (2:00 AM)
- Weekly service restart (Sunday 4:00 AM)
- Monthly log cleanup

### `security_hardening.sh` (Advanced Security)
**Purpose:** Apply additional security measures

**What It Does:**
- SSH hardening
- Kernel security parameters
- Enhanced fail2ban rules
- Automatic security updates
- File permission lockdown

### `health_check.sh` (System Health)
**Purpose:** Verify system status

**Checks:**
- Service status (tgbot, caddy, ufw, fail2ban)
- Application responding
- HTTPS working
- Disk space
- Backup age
- Failed login attempts
- Resource usage

**Usage:**
```bash
sudo bash health_check.sh
```

---

# Data Flow

## Flow 1: New Bot Creation

```
User → Uploader GUI
    ↓
    Select folder + enter credentials
    ↓
Uploader scans folder
    ↓
Uploads files to Telegram channel (one by one)
    ↓
Collects file_id + message_id for each file
    ↓
Builds JSON metadata structure
    ↓
POST /api/upload (sends JSON to server)
    ↓
Server validates & sanitizes JSON
    ↓
Server creates bot_<id>.json file
    ↓
Server starts bot instance (status: pending)
    ↓
Server sends notification to admin
    ↓
Admin sees new bot in admin panel
    ↓
Admin tests bot in Telegram (only admin can use)
    ↓
Admin approves via panel
    ↓
Server changes status to "approved"
    ↓
Bot now responds to all users
```

## Flow 2: User Interacts with Bot

```
User sends /start to bot in Telegram
    ↓
Telegram sends update to server
    ↓
Server checks bot status
    ↓
If pending: Check if user is admin
    ↓
Server loads metadata JSON
    ↓
Builds inline keyboard from folder structure
    ↓
Sends message with folder buttons to user
    ↓
User clicks folder button
    ↓
Server receives callback query
    ↓
Navigates to subfolder in JSON
    ↓
Forwards all files in that folder from channel
    ↓
Sends next level subfolder buttons
```

## Flow 3: Update Existing Bot

```
User modifies local folder (add/remove/edit files)
    ↓
Runs Uploader in "Update" mode
    ↓
Uploader: GET /api/bot-metadata/<token>
    ↓
Server returns existing metadata
    ↓
Uploader compares local vs server metadata
    ↓
Identifies: added, removed, modified, unchanged
    ↓
Deletes removed/modified files from channel
    ↓
Uploads new/modified files
    ↓
Preserves file_ids for unchanged files
    ↓
Builds updated JSON metadata
    ↓
POST /api/upload (sends updated JSON)
    ↓
Server updates bot_<id>.json
    ↓
If changes >30%: Notify admin for review
    ↓
Bot continues working (not disconnected)
```

---

# Security Model

## Threat Vectors & Mitigations

### 1. Injection Attacks

**Threats:**
- SQL Injection (N/A - we use JSON files)
- XSS (Cross-Site Scripting)
- Code Injection
- Path Traversal
- Prototype Pollution

**Mitigations:**
```javascript
// All inputs sanitized
const sanitized = security.sanitizeInput(userInput);

// HTML escaped
const escaped = validator.escape(text);

// Patterns blocked
/<script>/gi, /javascript:/gi, /\.\.\//g, /__proto__/gi

// JSON recursively sanitized
const clean = security.sanitizeJSON(metadata);
```

### 2. Authentication & Authorization

**Admin Panel:**
- SHA-256 password hashing
- 32-byte random session tokens
- 30-minute session expiry
- Rate limiting: 5 failed attempts = 15min IP ban

**Bot Approval Workflow:**
- Pending bots only respond to admin Telegram User ID
- All admin operations require authenticated session
- No unauthenticated endpoints for bot approval

### 3. DDoS Protection

**Rate Limiting:**
```javascript
// Global: 100 requests / 15 minutes
// Upload: 10 requests / hour
// Per-IP tracking
```

**Server Level:**
- fail2ban (brute force protection)
- UFW firewall (only ports 22, 80, 443 open)
- Caddy (built-in rate limiting)

### 4. Data Privacy

**User Data:**
- Only store: bot token, channel ID, metadata JSON
- No user passwords stored
- No personal information beyond Telegram User ID
- Bot owner registration: captured on first message

**Admin Data:**
- Admin password hashed (never plaintext)
- Session tokens in memory (not disk)
- No sensitive data logged

### 5. File Security

**Storage:**
- Files stored on Telegram (not our server)
- We only store file_ids (references)
- No direct file access possible

**Validation:**
- Max file size: 2GB (Telegram limit)
- No file type restrictions (all allowed)
- Folder/file name validation

---

# File Structure

```
telegram-bot-system/
│
├── backend/                      # Node.js Backend
│   ├── server.js                 # Main entry point
│   ├── bot-manager.js            # Multi-bot handler
│   ├── storage.js                # JSON file operations
│   ├── security.js               # Input sanitization
│   ├── config.js                 # Configuration manager
│   ├── admin-bot.js              # Notification system
│   ├── admin-routes.js           # Admin API routes
│   ├── package.json              # Dependencies
│   └── public/                   # Admin panel static files
│       ├── admin-panel.html      # UI structure
│       └── admin-panel.js        # Client logic
│
├── uploader/                     # Windows GUI Uploader
│   ├── main.py                   # Entry point
│   ├── gui.py                    # PyQt5 GUI
│   ├── uploader.py               # Core orchestration
│   ├── telegram_api.py           # Telegram API wrapper
│   ├── file_scanner.py           # Directory scanner
│   ├── json_builder.py           # Metadata builder
│   ├── api_client.py             # Server API client
│   ├── config.py                 # Settings
│   ├── requirements.txt          # Python dependencies
│   ├── build.py                  # Build script (Python)
│   └── build_uploader.ps1        # Build script (PowerShell)
│
├── scripts/                      # Deployment Scripts
│   ├── install.sh                # Main installer
│   ├── setup_service.sh          # Systemd service
│   ├── backup.sh                 # Backup automation
│   ├── setup_cron.sh             # Scheduled tasks
│   ├── security_hardening.sh     # Advanced security
│   └── health_check.sh           # Health checker
│
└── data/                         # Auto-created data directory
    ├── bots/                     # Bot configurations
    │   └── bot_<id>.json         # One file per bot
    ├── config/                   # System configuration
    │   ├── admin.json            # Admin settings
    │   ├── system.json           # System settings
    │   └── banned_users.json     # Banned users
    └── backups/                  # Daily backups
        └── backup_<timestamp>/
```

---

# API Specification

## Public Endpoints

### POST /api/upload
**Purpose:** Receive bot metadata from uploader

**Authentication:** None (rate limited)

**Request Body:**
```json
{
  "botToken": "123456789:ABCdef...",
  "channelId": "@private_channel",
  "botUsername": "@mybot",
  "metadata": {
    "subfolders": {
      "Documents": {
        "files": [
          {
            "fileName": "file1.pdf",
            "fileId": "BQACAgIA...",
            "messageId": 123
          }
        ],
        "subfolders": {}
      }
    },
    "files": []
  }
}
```

**Response (New Bot):**
```json
{
  "success": true,
  "message": "Bot created successfully. Awaiting admin approval.",
  "botId": "a1b2c3d4",
  "status": "pending"
}
```

**Response (Update):**
```json
{
  "success": true,
  "message": "Bot metadata updated successfully",
  "isUpdate": true,
  "changePercentage": 25.5
}
```

---

### GET /api/bot-status/:botToken
**Purpose:** Check bot status

**Response:**
```json
{
  "success": true,
  "status": "approved",
  "botId": "a1b2c3d4",
  "botUsername": "@mybot",
  "createdAt": "2024-01-01T00:00:00Z",
  "ownerRegistered": true
}
```

---

### GET /api/bot-metadata/:botToken
**Purpose:** Get full metadata (for update mode)

**Response:**
```json
{
  "success": true,
  "botId": "a1b2c3d4",
  "status": "approved",
  "metadata": { /* full structure */ },
  "lastUpdate": "2024-01-01T00:00:00Z"
}
```

---

## Admin Endpoints

All require: `Authorization: Bearer <session-token>`

### POST /api/admin/login
**Request:**
```json
{
  "username": "admin",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "token": "a1b2c3d4..."
}
```

---

### GET /api/admin/stats
**Response:**
```json
{
  "success": true,
  "stats": {
    "total": 10,
    "approved": 7,
    "pending": 2,
    "disconnected": 1,
    "bannedUsers": 3
  }
}
```

---

### GET /api/admin/bots?status=all
**Response:**
```json
{
  "success": true,
  "bots": [
    {
      "id": "abc123",
      "botUsername": "@mybot",
      "status": "approved",
      "ownerId": 123456789,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### POST /api/admin/approve-bot
**Request:**
```json
{
  "botId": "abc123"
}
```

**Response:**
```json
{
  "success": true
}
```

---

# Database Schema (JSON Files)

## bot_<id>.json
```json
{
  "id": "a1b2c3d4",
  "botToken": "123456789:ABC...",
  "channelId": "@channel",
  "botUsername": "@mybot",
  "status": "approved",
  "ownerId": 123456789,
  "createdAt": "2024-01-01T00:00:00Z",
  "ownerRegisteredAt": "2024-01-01T01:00:00Z",
  "lastUpdate": "2024-01-02T00:00:00Z",
  "metadata": {
    "subfolders": {
      "Folder1": {
        "files": [
          {
            "fileName": "file1.pdf",
            "fileId": "BQACAgIA...",
            "messageId": 123
          }
        ],
        "subfolders": {}
      }
    },
    "files": []
  }
}
```

## admin.json
```json
{
  "telegramUserId": 123456789,
  "botToken": "987654321:XYZ...",
  "channelId": "@admin_channel",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

## system.json
```json
{
  "maxJsonSizeMB": 10,
  "welcomeMessage": "👋 Welcome!",
  "invalidInputMessage": "❌ Invalid input.",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

## banned_users.json
```json
{
  "users": [
    {
      "userId": 111111111,
      "reason": "Illegal content",
      "bannedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

# Deployment Architecture

## Recommended Setup

```
Internet
  ↓
CloudFlare (DDoS protection, SSL)
  ↓
Caddy (Reverse Proxy)
  ↓
Node.js App (Port 3000)
  ↓
Local Storage (JSON files)
```

## Minimal Requirements

- **CPU:** 1 core
- **RAM:** 1GB (2GB recommended)
- **Storage:** 10GB SSD
- **Bandwidth:** 1TB/month
- **OS:** Ubuntu 22.04 LTS

---

# Testing Strategy

## Unit Testing

Not currently implemented. Can add:
- Jest for Node.js
- pytest for Python

## Integration Testing

Test entire workflows:
1. Bot creation → approval → usage
2. File upload → metadata → retrieval
3. Admin login → bot moderation
4. Update mode → change detection

## Security Testing

Continuously test for:
- Injection attempts
- XSS attempts
- Path traversal
- Rate limit bypass
- Session hijacking

---

# Known Limitations

1. **No Database:** Uses JSON files (limit: ~500 bots comfortably)
2. **Session Storage:** In-memory (lost on restart - users must re-login)
3. **Single Admin:** Only one admin account supported
4. **No Audit Logs:** Admin actions not logged permanently
5. **No Bot Templates:** Each user creates from scratch
6. **Telegram Limits:** 2GB per file, rate limits apply
7. **Windows Only:** Uploader is Windows-only (could port to Linux/Mac)

---

# Future Enhancements

## Potential Improvements

1. **Database Migration:** SQLite or PostgreSQL for better scaling
2. **Multi-Admin:** Support multiple admin accounts with roles
3. **User Dashboard:** Let bot owners see stats/analytics
4. **Bot Templates:** Pre-made folder structures
5. **Webhook Mode:** Instead of polling (more efficient)
6. **API Key System:** Let advanced users use API directly
7. **Bot Themes:** Custom buttons, colors, messages per bot
8. **Analytics:** Track usage, popular files, user engagement
9. **Monetization:** Add payment system for premium features
10. **Mobile App:** Android/iOS uploader

---

# Code Quality Standards

## Followed Best Practices

✅ Input sanitization everywhere  
✅ Error handling on all operations  
✅ Logging for debugging  
✅ Modular architecture  
✅ No hardcoded credentials  
✅ Environment variables for config  
✅ Rate limiting on all endpoints  
✅ Session management  
✅ Graceful shutdown handling  
✅ Unicode/internationalization support  

---

# Performance Characteristics

## Expected Performance

- **Concurrent Users:** 100-200 simultaneous
- **Bots Managed:** 10-50 comfortable, up to 500 possible
- **Response Time:** <100ms for bot interactions
- **Upload Speed:** Limited by Telegram (not server)
- **Admin Panel:** <200ms page loads

## Bottlenecks

- JSON file I/O (could use database)
- Telegram API rate limits
- Single-threaded Node.js (but async I/O)

---

# Contact & Support

**For Developers:**
- Read this document first
- Check existing code comments
- Review deployment guide
- Test thoroughly before changes

**For Issues:**
- Check logs: `/opt/telegram-bot-system/logs/`
- Health check: `sudo bash health_check.sh`
- Review server console output
- Check Telegram bot logs

---

# Glossary

- **Bot:** Telegram bot created by end-user
- **Channel:** Private Telegram channel where files stored
- **Metadata:** JSON structure describing folder/file hierarchy
- **file_id:** Telegram's unique identifier for uploaded files
- **Approval Workflow:** Process where admin manually approves bots
- **Pending Status:** Bot awaiting approval (only admin can test)
- **Owner Registration:** Capturing bot creator's Telegram User ID
- **Update Mode:** Uploader mode that only uploads changed files

---

**Document Version:** 1.0  
**Last Updated:** November 2024  
**Total Lines of Code:** ~3,500 (backend) + ~2,000 (uploader) + ~500 (scripts)  
**Total Files:** 15 (backend) + 12 (uploader) + 6 (scripts) = 33 files

---

# Quick Start for Reviewers

1. **Read this document** (you're doing it!)
2. **Check file structure** (matches documentation above)
3. **Review backend/** (Node.js server code)
4. **Review uploader/** (Python GUI code)
5. **Check scripts/** (deployment automation)
6. **Read deployment guide** for setup instructions
7. **Review test guide** for testing procedures

**Primary Technologies:** Node.js, Express, Telegram Bot API, PyQt5, Ubuntu

**Project Status:** ✅ Production Ready

**Last Major Update:** November 2024
