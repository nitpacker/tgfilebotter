// storage.js - JSON File Storage Management (RACE CONDITION FIXES + ALL BUG FIXES APPLIED)
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// CRITICAL FIX [ST-12]: Make proper-lockfile mandatory for data integrity
// If this import fails, the error message will be clear:
// "Cannot find module 'proper-lockfile'"
// Solution: npm install proper-lockfile
const lockfile = require('proper-lockfile');

class Storage {
  constructor() {
    this.dataDir = path.join(__dirname, '..', 'data');
    this.botsDir = path.join(this.dataDir, 'bots');
    this.configDir = path.join(this.dataDir, 'config');
    this.backupsDir = path.join(this.dataDir, 'backups');
    
    // Write queue for atomic operations
    this.writeQueue = new Map(); // botId -> Promise
    
    // Caching layer with TTL
    this.botCache = new Map(); // botId -> { data, timestamp }
    this.CACHE_TTL = 60000; // 1 minute
    
    // SECURITY FIX: Track ongoing operations to prevent race conditions
    this.ongoingOperations = new Set();
    
    this.initializeDirectories();
  }

  async initializeDirectories() {
    try {
      await fsPromises.mkdir(this.dataDir, { recursive: true });
      await fsPromises.mkdir(this.botsDir, { recursive: true });
      await fsPromises.mkdir(this.configDir, { recursive: true });
      await fsPromises.mkdir(this.backupsDir, { recursive: true });
      
      // SECURITY FIX: Set restrictive permissions on data directories
      await fsPromises.chmod(this.dataDir, 0o750);
      await fsPromises.chmod(this.botsDir, 0o750);
      await fsPromises.chmod(this.configDir, 0o750);
      await fsPromises.chmod(this.backupsDir, 0o750);
      
      console.log('✓ Storage directories initialized');
    } catch (error) {
      // FIX [ST-8]: Add specific error handling for EACCES and ENOSPC
      if (error.code === 'EACCES') {
        console.error('❌ Permission denied creating storage directories');
        console.error('   Run with appropriate permissions or check directory ownership');
      } else if (error.code === 'ENOSPC') {
        console.error('❌ No space left on device');
        console.error('   Free up disk space and try again');
      } else {
        console.error('Error initializing directories:', error);
      }
      throw error; // Re-throw with better context
    }
  }

  // FIX [ST-1]: Atomic bot status update with proper nested try/finally for lock release
  async updateBotStatusAtomic(botId, status) {
    const operationId = `status_${botId}_${Date.now()}`;
    
    // Prevent concurrent operations on same bot
    if (this.ongoingOperations.has(botId)) {
      console.warn(`Operation already in progress for bot ${botId}, queuing...`);
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.updateBotStatusAtomic(botId, status);
    }
    
    this.ongoingOperations.add(botId);
    
    let release;
    try {
      const filePath = path.join(this.botsDir, `bot_${botId}.json`);
      
      // Acquire file lock
      try {
        release = await lockfile.lock(filePath, {
          retries: {
            retries: 5,
            minTimeout: 100,
            maxTimeout: 1000
          }
        });
      } catch (error) {
        console.error(`Failed to acquire lock for bot ${botId}:`, error);
		this.ongoingOperations.delete(botId); // Delete here on lock failure
        return false;
      }
      
      try {
        // Read current state
        const data = await fsPromises.readFile(filePath, 'utf8');
        const bot = JSON.parse(data);
        
        // Update status
        bot.status = status;
        bot.statusChangedAt = new Date().toISOString();
        bot.statusChangedBy = operationId;
        
        // Write atomically
        const tempPath = `${filePath}.tmp`;
        await fsPromises.writeFile(tempPath, JSON.stringify(bot, null, 2), 'utf8');
        await fsPromises.rename(tempPath, filePath);
        
        // SECURITY FIX: Set restrictive permissions
        await fsPromises.chmod(filePath, 0o640);
        
        // Invalidate cache
        this.clearCache(botId);
        
        return true;
      } finally {
        // FIX [ST-1]: CRITICAL - Release lock in inner finally
        if (release) await release();
      }
    } catch (error) {
      console.error(`Error updating bot status for ${botId}:`, error);
      return false;
    } finally {
      this.ongoingOperations.delete(botId);
    }
  }

  // SECURITY FIX: Create operation backup with error handling
  async createOperationBackup(operation, data) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(
        this.backupsDir, 
        `operation_${operation}_${timestamp}.json`
      );
      
      await fsPromises.writeFile(
        backupPath,
        JSON.stringify({
          operation,
          timestamp,
          data
        }, null, 2)
      );
      
      // SECURITY FIX: Set restrictive permissions
      await fsPromises.chmod(backupPath, 0o640);
      
      return true;
    } catch (error) {
      console.error('Failed to create operation backup:', error);
      return false;
    }
  }

  // Bot Operations
  createBot(botData) {
    const botId = this.generateBotId();
    const bot = {
      id: botId,
      ...botData,
      createdAt: botData.createdAt || new Date().toISOString(),
      status: botData.status || 'pending',
      ownerId: null
    };

    this.saveBotSync(bot);
    return botId;
  }

  // SECURITY FIX: Replace synchronous save with async
  async saveBot(bot) {
    const filePath = path.join(this.botsDir, `bot_${bot.id}.json`);
    
    // Acquire lock
    let release;
    try {
      release = await lockfile.lock(filePath, {
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 1000
        }
      });
    } catch (error) {
      // File doesn't exist yet, create it
      if (error.code === 'ENOENT') {
        await fsPromises.writeFile(filePath, JSON.stringify(bot, null, 2), 'utf8');
        await fsPromises.chmod(filePath, 0o640);
        this.clearCache(bot.id);
        return;
      }
      throw error;
    }
    
    try {
      // Write atomically
      const tempPath = `${filePath}.tmp`;
      await fsPromises.writeFile(tempPath, JSON.stringify(bot, null, 2), 'utf8');
      await fsPromises.rename(tempPath, filePath);
      await fsPromises.chmod(filePath, 0o640);
      this.clearCache(bot.id);
    } finally {
      await release();
    }
  }

  // FIX [ST-2]: DEPRECATED - Use saveBot() instead - kept for backward compatibility with cleanup
  saveBotSync(bot) {
    const filePath = path.join(this.botsDir, `bot_${bot.id}.json`);
    const tempPath = `${filePath}.tmp`;
    
    try {
      // SECURITY FIX: Write to temp file first, then rename (atomic operation)
      fs.writeFileSync(tempPath, JSON.stringify(bot, null, 2), 'utf8');
      fs.renameSync(tempPath, filePath);
      fs.chmodSync(filePath, 0o640);
      this.clearCache(bot.id);
    } catch (err) {
      console.error(`Error saving bot ${bot.id}:`, err);
    } finally {
      // FIX [ST-2]: Ensure temp file is cleaned up
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (cleanupErr) {
        // Ignore cleanup errors
      }
    }
  }

  // Caching with proper invalidation
  getBotById(botId, useCache = true) {
    // Check cache first
    if (useCache) {
      const cached = this.botCache.get(botId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }
    }

    try {
      const filePath = path.join(this.botsDir, `bot_${botId}.json`);
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const data = fs.readFileSync(filePath, 'utf8');
      const bot = JSON.parse(data);
      
      // Update cache
      this.botCache.set(botId, {
        data: bot,
        timestamp: Date.now()
      });
      
      return bot;
    } catch (error) {
      // FIX [ST-4]: Log parse errors with details
      if (error instanceof SyntaxError) {
        console.error(`JSON parse error for bot ${botId}:`, {
          file: path.join(this.botsDir, `bot_${botId}.json`),
          error: error.message
        });
      } else {
        console.error(`Error reading bot ${botId}:`, error);
      }
      return null;
    }
  }

  getBotByToken(token) {
    const allBots = this.getAllBots();
    return allBots.find(bot => bot.botToken === token);
  }

  getAllBots() {
    try {
      if (!fs.existsSync(this.botsDir)) {
        return [];
      }
      
      const files = fs.readdirSync(this.botsDir);
      const bots = [];

      for (const file of files) {
        if (file.startsWith('bot_') && file.endsWith('.json') && !file.endsWith('.tmp')) {
          try {
            const filePath = path.join(this.botsDir, file);
            const data = fs.readFileSync(filePath, 'utf8');
            const bot = JSON.parse(data);
            bots.push(bot);
          } catch (error) {
            // FIX [ST-4]: Log parse errors with details for getAllBots
            if (error instanceof SyntaxError) {
              console.error(`JSON parse error in file ${file}:`, {
                file: path.join(this.botsDir, file),
                error: error.message
              });
            } else {
              console.error(`Error reading bot file ${file}:`, error);
            }
          }
        }
      }

      return bots;
    } catch (error) {
      console.error('Error getting all bots:', error);
      return [];
    }
  }

  async updateBot(botToken, updates) {
    const bot = this.getBotByToken(botToken);
    if (!bot) return false;

    const updatedBot = {
      ...bot,
      ...updates,
      lastUpdate: new Date().toISOString()
    };

    await this.saveBot(updatedBot);
    return true;
  }

  updateBotStatus(botId, status) {
    const bot = this.getBotById(botId, false);
    if (!bot) return false;

    bot.status = status;
    bot.statusChangedAt = new Date().toISOString();
    
    this.saveBotSync(bot);
    return true;
  }

  registerBotOwner(botId, ownerId) {
    const bot = this.getBotById(botId, false);
    if (!bot) return false;

    bot.ownerId = ownerId;
    bot.ownerRegisteredAt = new Date().toISOString();
    
    this.saveBotSync(bot);
    return true;
  }

  async deleteBot(botId) {
    try {
      const filePath = path.join(this.botsDir, `bot_${botId}.json`);
      await fsPromises.unlink(filePath);
      this.clearCache(botId);
      return true;
    } catch (error) {
      console.error(`Error deleting bot ${botId}:`, error);
      return false;
    }
  }

  getBotsByOwner(ownerId) {
    const allBots = this.getAllBots();
    return allBots.filter(bot => bot.ownerId === ownerId);
  }

  // Cache management
  clearCache(botId = null) {
    if (botId) {
      this.botCache.delete(botId);
    } else {
      this.botCache.clear();
    }
  }

  // SECURITY FIX: Periodic cache cleanup
  startCacheCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [botId, cached] of this.botCache.entries()) {
        if (now - cached.timestamp > this.CACHE_TTL) {
          this.botCache.delete(botId);
        }
      }
    }, 60000); // Clean every minute
  }

  // Change detection for updates
  calculateChangePercentage(oldMetadata, newMetadata) {
    try {
      const oldFiles = this.countFilesRecursive(oldMetadata);
      const newFiles = this.countFilesRecursive(newMetadata);
      
      const oldFileIds = new Set(this.extractFileIds(oldMetadata));
      const newFileIds = new Set(this.extractFileIds(newMetadata));
      
      const addedFiles = [...newFileIds].filter(id => !oldFileIds.has(id)).length;
      const removedFiles = [...oldFileIds].filter(id => !newFileIds.has(id)).length;
      const totalChanges = addedFiles + removedFiles;
      
      const baseCount = Math.max(oldFiles, newFiles, 1);
      const changePercentage = (totalChanges / baseCount) * 100;
      
      return Math.min(changePercentage, 100);
    } catch (error) {
      console.error('Error calculating change percentage:', error);
      return 0;
    }
  }

  countFilesRecursive(metadata) {
    if (!metadata) return 0;
    let count = (metadata.files || []).length;
    
    if (metadata.subfolders) {
      for (const subfolder of Object.values(metadata.subfolders)) {
        count += this.countFilesRecursive(subfolder);
      }
    }
    
    return count;
  }

  extractFileIds(metadata, ids = []) {
    if (!metadata) return ids;
    
    if (metadata.files) {
      ids.push(...metadata.files.map(f => f.fileId || f.messageId));
    }
    
    if (metadata.subfolders) {
      for (const subfolder of Object.values(metadata.subfolders)) {
        this.extractFileIds(subfolder, ids);
      }
    }
    
    return ids;
  }

  // Configuration Management
  async loadConfig(configName) {
    try {
      const filePath = path.join(this.configDir, `${configName}.json`);
      const data = await fsPromises.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      // FIX [ST-4]: Log parse errors with details for config files
      if (error instanceof SyntaxError) {
        console.error(`JSON parse error for config ${configName}:`, {
          file: path.join(this.configDir, `${configName}.json`),
          error: error.message
        });
      } else {
        console.error(`Error loading config ${configName}:`, error);
      }
      throw error;
    }
  }

  async saveConfig(configName, data) {
    try {
      const filePath = path.join(this.configDir, `${configName}.json`);
      
      // SECURITY FIX: Atomic write with temp file
      const tempPath = `${filePath}.tmp`;
      await fsPromises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
      await fsPromises.rename(tempPath, filePath);
      await fsPromises.chmod(filePath, 0o640);
      
      return true;
    } catch (error) {
      console.error(`Error saving config ${configName}:`, error);
      throw error;
    }
  }

  // Banned Users Management
  async getBannedUsers() {
    const config = await this.loadConfig('banned_users');
    return config ? config.users || [] : [];
  }

  async addBannedUser(userId, reason = '') {
    let config = await this.loadConfig('banned_users') || { users: [] };
    
    if (!config.users.find(u => u.userId === userId)) {
      config.users.push({
        userId,
        reason,
        bannedAt: new Date().toISOString()
      });
      
      await this.saveConfig('banned_users', config);
    }
    
    return true;
  }

  async isBanned(userId) {
    const bannedUsers = await this.getBannedUsers();
    return bannedUsers.some(u => u.userId === userId);
  }

  // Backup Operations
  async createBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(this.backupsDir, `backup_${timestamp}`);
      
      await fsPromises.mkdir(backupDir, { recursive: true });

      // Copy bots directory
      await this.copyDirectory(this.botsDir, path.join(backupDir, 'bots'));
      
      // Copy config directory
      await this.copyDirectory(this.configDir, path.join(backupDir, 'config'));

      // Create backup manifest
      const manifest = {
        timestamp,
        createdAt: new Date().toISOString(),
        botCount: this.getAllBots().length,
        checksum: await this.calculateDirectoryChecksum(backupDir)
      };

      await fsPromises.writeFile(
        path.join(backupDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      );

      console.log(`✓ Backup created: ${backupDir}`);
      return { success: true, backupDir, manifest };

    } catch (error) {
      console.error('Error creating backup:', error);
      return { success: false, error: error.message };
    }
  }

  async copyDirectory(src, dest) {
    await fsPromises.mkdir(dest, { recursive: true });
    
    if (!fs.existsSync(src)) {
      return;
    }
    
    const entries = await fsPromises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fsPromises.copyFile(srcPath, destPath);
      }
    }
  }

  async calculateDirectoryChecksum(dirPath) {
    const files = await this.getAllFilesRecursive(dirPath);
    const hash = crypto.createHash('sha256');

    for (const file of files.sort()) {
      const content = await fsPromises.readFile(file);
      hash.update(content);
    }

    return hash.digest('hex');
  }

  async getAllFilesRecursive(dirPath, fileList = []) {
    if (!fs.existsSync(dirPath)) {
      return fileList;
    }
    
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.getAllFilesRecursive(fullPath, fileList);
      } else {
        fileList.push(fullPath);
      }
    }

    return fileList;
  }

  // Utility
  generateBotId() {
    return crypto.randomBytes(8).toString('hex');
  }
}

module.exports = Storage;