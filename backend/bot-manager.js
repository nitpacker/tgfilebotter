// bot-manager.js - Manages Multiple Telegram Bots (PRODUCTION-READY - ALL FIXES APPLIED)
const TelegramBot = require('node-telegram-bot-api');
const Security = require('./security');
const crypto = require('crypto');

class BotManager {
  constructor(storage, config, adminBot) {
    this.storage = storage;
    this.config = config;
    this.adminBot = adminBot;
    this.security = new Security();
    this.bots = new Map(); // botId -> bot instance
    this.botTokenMap = new Map(); // token -> botId
    
    // CRITICAL FIX #5: Add circuit breaker for failing bots with persistence
    this.circuitBreakers = new Map(); // botId -> { failures, lastFailure, state }
    this.CIRCUIT_BREAKER_THRESHOLD = 5;
    this.CIRCUIT_BREAKER_TIMEOUT = 300000; // 5 minutes
    this.circuitBreakerFile = null; // Will be set in loadAllBots
    
    // Recovery monitoring
    this.recoveryInterval = null;
    this.circuitBreakerCleanupInterval = null; // BM-2: Track cleanup interval
    
    // CRITICAL FIX #1 (BM-3): Limit error tracking to prevent memory leaks
    this.MAX_ERROR_HISTORY = 10;
    
    // BM-7: Track ongoing operations to prevent race conditions
    this.ongoingOperations = new Map(); // botId -> Promise
    
    // BM-16: Path hash map for long folder paths
    this.pathHashes = new Map(); // hash -> {path, expires}
    
    // MINOR FIX #10: Structured logging
    this.logger = {
      error: (msg, ...args) => console.error(`[BotManager] ${msg}`, ...args),
      warn: (msg, ...args) => console.warn(`[BotManager] ${msg}`, ...args),
      info: (msg, ...args) => console.log(`[BotManager] ${msg}`, ...args)
    };
  }

  // BM-6: Sanitize token in messages
  sanitizeToken(message, token) {
    if (typeof message !== 'string') {
      message = String(message);
    }
    if (token && message.includes(token)) {
      const prefix = token.substring(0, 4);
      const suffix = token.substring(token.length - 4);
      return message.replace(new RegExp(token, 'g'), `${prefix}...${suffix}`);
    }
    return message;
  }

  async loadAllBots() {
    try {
      const allBots = this.storage.getAllBots();
      this.logger.info(`Loading ${allBots.length} bots...`);

      // CRITICAL FIX #5: Set circuit breaker file path
      const path = require('path');
      this.circuitBreakerFile = path.join(
        __dirname, '..', 'data', 'config', 'circuit_breakers.json'
      );
      
      // Load circuit breaker state
      await this.loadCircuitBreakerState();

      for (const botData of allBots) {
        if (botData.status !== 'banned' && botData.status !== 'disconnected') {
          await this.addBot(
            botData.id,
            botData.botToken,
            botData.channelId,
            botData.metadata,
            botData.status,
            botData.ownerId
          );
        }
      }

      this.logger.info(`✓ Loaded ${this.bots.size} active bots`);
      
      // Start recovery monitor
      this.startRecoveryMonitor();
      
      // CRITICAL FIX #5 (BM-2): Start circuit breaker cleanup and persistence
      this.startCircuitBreakerCleanup();
      
    } catch (error) {
      this.logger.error('Error loading bots:', error);
      throw error;
    }
  }

  // CRITICAL FIX #5: Load circuit breaker state from disk
  async loadCircuitBreakerState() {
    try {
      const fs = require('fs').promises;
      const data = await fs.readFile(this.circuitBreakerFile, 'utf8');
      const saved = JSON.parse(data);
      
      for (const [botId, breaker] of Object.entries(saved)) {
        this.circuitBreakers.set(botId, breaker);
      }
      
      this.logger.info(`✓ Loaded circuit breaker state for ${this.circuitBreakers.size} bots`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.warn('Could not load circuit breaker state:', error.message);
      }
    }
  }

  // CRITICAL FIX #5: Save circuit breaker state to disk
  async saveCircuitBreakerState() {
    try {
      const fs = require('fs').promises;
      const state = {};
      
      for (const [botId, breaker] of this.circuitBreakers.entries()) {
        state[botId] = breaker;
      }
      
      const tempFile = `${this.circuitBreakerFile}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(state, null, 2));
      await fs.rename(tempFile, this.circuitBreakerFile);
    } catch (error) {
      this.logger.error('Error saving circuit breaker state:', error);
    }
  }

  // CRITICAL FIX #5: Check circuit breaker before starting bot
  isCircuitBreakerOpen(botId) {
    const breaker = this.circuitBreakers.get(botId);
    if (!breaker) return false;
    
    if (breaker.state === 'open') {
      // Check if timeout has passed
      if (Date.now() - breaker.lastFailure > this.CIRCUIT_BREAKER_TIMEOUT) {
        breaker.state = 'half-open';
        breaker.failures = 0;
        this.saveCircuitBreakerState(); // Persist state change
        return false;
      }
      return true;
    }
    
    return false;
  }

  recordBotFailure(botId) {
    let breaker = this.circuitBreakers.get(botId);
    if (!breaker) {
      breaker = { failures: 0, lastFailure: 0, state: 'closed' };
      this.circuitBreakers.set(botId, breaker);
    }
    
    breaker.failures++;
    breaker.lastFailure = Date.now();
    
    if (breaker.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      breaker.state = 'open';
      this.logger.error(`Circuit breaker opened for bot ${botId} after ${breaker.failures} failures`);
      this.adminBot.sendAlert('error', 
        `Bot ${botId} circuit breaker opened due to repeated failures`
      ).catch(err => this.logger.error('Failed to send alert:', err));
    }
    
    // CRITICAL FIX #5: Persist state after failure
    this.saveCircuitBreakerState();
  }

  recordBotSuccess(botId) {
    const breaker = this.circuitBreakers.get(botId);
    if (breaker && breaker.state === 'half-open') {
      breaker.state = 'closed';
      breaker.failures = 0;
      this.logger.info(`Circuit breaker closed for bot ${botId}`);
      
      // CRITICAL FIX #5: Persist state after success
      this.saveCircuitBreakerState();
    }
  }

  // BM-2: Start circuit breaker cleanup with interval tracking
  startCircuitBreakerCleanup() {
    this.circuitBreakerCleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = false;
      
      for (const [botId, breaker] of this.circuitBreakers.entries()) {
        // Remove old circuit breaker data
        if (now - breaker.lastFailure > this.CIRCUIT_BREAKER_TIMEOUT * 2) {
          this.circuitBreakers.delete(botId);
          cleaned = true;
        }
      }
      
      // CRITICAL FIX #5: Persist state if anything was cleaned
      if (cleaned) {
        this.saveCircuitBreakerState();
      }
    }, 600000); // Clean every 10 minutes
  }

  async addBot(botId, token, channelId, metadata, status = 'pending', ownerId = null) {
    // BM-7: Check if operation already in progress
    if (this.ongoingOperations.has(botId)) {
      this.logger.warn(`Add operation already in progress for bot ${botId}`);
      return this.ongoingOperations.get(botId);
    }
    
    // Create promise for this operation
    const operationPromise = this._addBotInternal(botId, token, channelId, metadata, status, ownerId);
    this.ongoingOperations.set(botId, operationPromise);
    
    try {
      const result = await operationPromise;
      return result;
    } finally {
      this.ongoingOperations.delete(botId);
    }
  }

  async _addBotInternal(botId, token, channelId, metadata, status, ownerId) {
	let bot = null;
    try {
      // CRITICAL FIX #5: Check circuit breaker
      if (this.isCircuitBreakerOpen(botId)) {
        this.logger.warn(`Cannot start bot ${botId}: circuit breaker is open`);
        return null;
      }

      // Create bot instance with error handling
      bot = new TelegramBot(token, { 
        polling: {
          interval: 300,
          autoStart: true,
          params: {
            timeout: 10
          }
        }
      });
      
      // Test bot connection before adding
      try {
        await bot.getMe();
        this.recordBotSuccess(botId);
      } catch (error) {
        this.recordBotFailure(botId);
        // BM-6: Sanitize token in error message
        const sanitizedError = this.sanitizeToken(error.message, token);
        throw new Error(`Bot token invalid or revoked: ${sanitizedError}`);
      }
      
      // Store bot info
      const botInfo = {
        instance: bot,
        botId,
        token,
        channelId,
        metadata,
        status,
        ownerId,
        started: new Date().toISOString(),
        errors: [], // CRITICAL FIX #1 (BM-3): Limited error history
        lastHealthCheck: Date.now(),
        consecutiveFailures: 0, // BM-11: Track consecutive failures
        lastCheckTime: Date.now() // BM-11: Track last check time
      };

      this.bots.set(botId, botInfo);
      this.botTokenMap.set(token, botId);

      // Setup handlers with error isolation
      this.setupBotHandlers(botInfo);

      this.logger.info(`✓ Bot ${botId} initialized (status: ${status})`);
      return botId;

    } catch (error) {
      // BM-6: Sanitize token in error log
      const sanitizedError = this.sanitizeToken(error.message, token);
      this.logger.error(`❌ Error adding bot ${botId}:`, sanitizedError);
      this.recordBotFailure(botId);
      
      // BM-14: Cleanup partial state on failure
      if (bot) {
        try {
          await bot.stopPolling();
        } catch (stopError) {
          // Ignore errors during cleanup
        }
      }
      this.bots.delete(botId);
      this.botTokenMap.delete(token);
      
      // BM-6: Sanitize token before sending alert
      const alertMessage = this.sanitizeToken(`Failed to initialize bot ${botId}: ${error.message}`, token);
      await this.adminBot.sendAlert('error', alertMessage);
      return null;
    }
  }

  setupBotHandlers(botInfo) {
    const { instance: bot, botId, channelId, metadata, status, ownerId } = botInfo;
    const adminUserId = this.config.getAdminUserId();

    // CRITICAL FIX #1 (BM-3): Global error handler with proper error isolation and size check
    bot.on('polling_error', (error) => {
      // BM-6: Sanitize token in error log
      const sanitizedError = this.sanitizeToken(error.message, botInfo.token);
      this.logger.error(`Polling error for bot ${botId}:`, sanitizedError);
      
      // CRITICAL FIX #1 (BM-3): Limit error history BEFORE pushing
      if (!botInfo.errors) botInfo.errors = [];
      
      if (botInfo.errors.length < this.MAX_ERROR_HISTORY) {
        botInfo.errors.push({
          timestamp: new Date().toISOString(),
          error: sanitizedError,
          type: 'polling'
        });
      }
      
      this.recordBotFailure(botId);
      
      // If too many errors, stop bot
      if (botInfo.errors.length >= this.MAX_ERROR_HISTORY) {
        this.logger.error(`Bot ${botId} has too many errors, stopping...`);
        this.stopBot(botId).catch(err => this.logger.error('Error stopping bot:', err));
        this.adminBot.sendAlert('error', 
          `Bot ${botId} stopped due to repeated errors`
        ).catch(err => this.logger.error('Failed to send alert:', err));
      }
    });

    // CRITICAL FIX #1: Wrap all handlers in try-catch
    const safeHandler = (handler) => {
      return async (...args) => {
        try {
          await handler(...args);
          this.recordBotSuccess(botId);
        } catch (error) {
          // BM-6: Sanitize token in error log
          const sanitizedError = this.sanitizeToken(error.message, botInfo.token);
          this.logger.error(`Handler error for bot ${botId}:`, sanitizedError);
          
          // BM-3: Check size before pushing error
          if (!botInfo.errors) botInfo.errors = [];
          if (botInfo.errors.length < this.MAX_ERROR_HISTORY) {
            botInfo.errors.push({
              timestamp: new Date().toISOString(),
              error: sanitizedError,
              type: 'handler'
            });
          }
          
          this.recordBotFailure(botId);
          // Don't rethrow - isolate error
        }
      };
    };

    // Handle /start command with error isolation
    bot.onText(/\/start/, safeHandler(async (msg) => {
      const userId = msg.from.id;
      const chatId = msg.chat.id;

      // Sanitize message
      const sanitizedMsg = this.security.sanitizeTelegramMessage(msg);
      if (!sanitizedMsg) {
        await this.adminBot.sendAlert('security', 
          `Malicious message blocked from user ${userId} in bot ${botId}`
        );
        return;
      }

      // Check bot status and user permissions
      if (status === 'pending') {
        if (userId !== adminUserId) {
          return;
        }
        await bot.sendMessage(chatId, 
          `⚠️ ADMIN TEST MODE ⚠️\n\nThis bot is pending approval. You are testing as admin.`
        );
      } else if (status === 'disconnected') {
        await bot.sendMessage(chatId, 
          '⛔ This bot is currently disconnected. Please contact the administrator.'
        );
        return;
      } else if (status === 'banned') {
        return;
      }

      // Send welcome message
      const welcomeMsg = this.config.getWelcomeMessage();
      await bot.sendMessage(chatId, welcomeMsg);

      // Show main menu
      await this.sendFolderMenu(bot, chatId, metadata, []);
    }));

    // Handle text messages (for owner registration)
    bot.on('message', safeHandler(async (msg) => {
      // Skip if it's a command
      if (msg.text && msg.text.startsWith('/')) return;

      const userId = msg.from.id;
      const chatId = msg.chat.id;
      const text = msg.text || '';

      // Sanitize message
      const sanitizedMsg = this.security.sanitizeTelegramMessage(msg);
      if (!sanitizedMsg) {
        await this.adminBot.sendAlert('security', 
          `Malicious message blocked from user ${userId} in bot ${botId}`
        );
        return;
      }

      // CRITICAL FIX #1: Limit text length
      if (text.length > 4096) {
        await bot.sendMessage(chatId, 'Message too long. Please use shorter messages.');
        return;
      }

      // Check if this is owner registration
      if (!ownerId && text.toLowerCase().includes('register')) {
        this.storage.registerBotOwner(botId, userId);
        botInfo.ownerId = userId;

        await bot.sendMessage(chatId, 
          '✅ Registration successful! Your bot has been submitted for review.\n\n' +
          'You will be notified once approved.'
        );

        await this.adminBot.sendAlert('registration', 
          `Bot ${botId} owner registered\nUser ID: ${userId}\nBot needs approval`
        );

        return;
      }

      // For other text messages, send invalid input message
      const invalidMsg = this.config.getInvalidInputMessage();
      await bot.sendMessage(chatId, invalidMsg);
    }));

    // Handle inline keyboard callbacks
    bot.on('callback_query', safeHandler(async (query) => {
      const userId = query.from.id;
      const chatId = query.message.chat.id;
      const data = query.data;

      // Sanitize callback data
      const sanitizedData = this.security.sanitizeInput(data);
      if (!sanitizedData) {
        await this.adminBot.sendAlert('security', 
          `Malicious callback blocked from user ${userId} in bot ${botId}`
        );
        await bot.answerCallbackQuery(query.id, { text: 'Invalid request' });
        return;
      }

      // CRITICAL FIX #1: Limit callback data length
      if (sanitizedData.length > 256) {
        await bot.answerCallbackQuery(query.id, { text: 'Request too long' });
        return;
      }

      // Check bot status
      if (status === 'pending' && userId !== adminUserId) {
        await bot.answerCallbackQuery(query.id);
        return;
      }

      if (status === 'disconnected' || status === 'banned') {
        await bot.answerCallbackQuery(query.id);
        return;
      }

      // BM-16: Check for hashed path
      let actualData = sanitizedData;
      if (sanitizedData.startsWith('folder|hash:')) {
        const hash = sanitizedData.substring('folder|hash:'.length);
        const cached = this.pathHashes.get(hash);
        if (cached && Date.now() < cached.expires) {
          actualData = `folder|${cached.path}`;
        } else {
          await bot.answerCallbackQuery(query.id, { text: 'Path expired, please start over' });
          return;
        }
      }

      // Parse callback data
      const [action, ...pathParts] = actualData.split('|');
      const path = pathParts.join('|').split('/').filter(p => p);

      if (action === 'folder') {
        await this.sendFolderMenu(bot, chatId, metadata, path);
        await bot.answerCallbackQuery(query.id);

      } else if (action === 'main') {
        await this.sendFolderMenu(bot, chatId, metadata, []);
        await bot.answerCallbackQuery(query.id, { text: 'Returned to main menu' });

      } else if (action === 'page') {
        const pageNum = parseInt(pathParts[0]);
        const currentPath = pathParts.slice(1).join('|').split('/').filter(p => p);
        await this.sendFolderMenu(bot, chatId, metadata, currentPath, pageNum);
        await bot.answerCallbackQuery(query.id);
      }
    }));
  }

  async sendFolderMenu(bot, chatId, metadata, currentPath, page = 0) {
    try {
      // Navigate to current folder
      let currentFolder = metadata;
      for (const folder of currentPath) {
        if (!currentFolder.subfolders || !currentFolder.subfolders[folder]) {
          await bot.sendMessage(chatId, '❌ Folder not found.');
          return;
        }
        currentFolder = currentFolder.subfolders[folder];
      }

      // Get subfolders
      const subfolders = Object.keys(currentFolder.subfolders || {}).sort((a, b) => 
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );

      // Get files
      const files = currentFolder.files || [];

      // Forward files if present
      if (files.length > 0 && page === 0) {
        await bot.sendMessage(chatId, `📁 Sending ${files.length} file(s)...`);
        
        for (const file of files) {
          try {
            await bot.forwardMessage(
              chatId, 
              currentFolder.channelId || metadata.channelId, 
              file.messageId
            );
          } catch (error) {
            // BM-10: Log error with file context
            this.logger.error('Error forwarding file:', {
              fileName: file.fileName,
              messageId: file.messageId,
              channelId: currentFolder.channelId || metadata.channelId,
              error: error.message
            });
          }
        }
      }

      // Prepare inline keyboard for subfolders
      if (subfolders.length === 0) {
        if (files.length === 0) {
          await bot.sendMessage(chatId, '📭 This folder is empty.');
        }
        
        if (currentPath.length > 0) {
          const keyboard = {
            inline_keyboard: [[
              { text: '🏠 Main Menu', callback_data: 'main|' }
            ]]
          };
          await bot.sendMessage(chatId, 'Navigation:', { reply_markup: keyboard });
        }
        return;
      }

      // Pagination
      const ITEMS_PER_PAGE = 30;
      const BUTTONS_PER_ROW = 10;
      
      const startIdx = page * ITEMS_PER_PAGE;
      const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, subfolders.length);
      const pageSubfolders = subfolders.slice(startIdx, endIdx);

      // Create button rows
      const buttons = [];
      for (let i = 0; i < pageSubfolders.length; i += BUTTONS_PER_ROW) {
        const row = pageSubfolders.slice(i, i + BUTTONS_PER_ROW).map(folder => {
          // BM-16: Validate callback_data length
          const fullPath = [...currentPath, folder].join('/');
          let callback_data = `folder|${fullPath}`;
          
          if (callback_data.length > 60) {
            // Create hash for long paths
            const hash = require('crypto').createHash('md5').update(fullPath).digest('hex').substring(0, 8);
            this.pathHashes.set(hash, {
              path: fullPath,
              expires: Date.now() + 600000 // 10 minutes
            });
            callback_data = `folder|hash:${hash}`;
          }
          
          return {
            text: `📁 ${folder}`,
            callback_data: callback_data
          };
        });
        buttons.push(row);
      }

      // Add navigation buttons
      const navButtons = [];
      const totalPages = Math.ceil(subfolders.length / ITEMS_PER_PAGE);

      if (page > 0) {
        navButtons.push({ 
          text: '⬅️ Back', 
          callback_data: `page|${page - 1}|${currentPath.join('/')}` 
        });
      }
      if (page < totalPages - 1) {
        navButtons.push({ 
          text: '➡️ Next', 
          callback_data: `page|${page + 1}|${currentPath.join('/')}` 
        });
      }
      if (currentPath.length > 0) {
        navButtons.push({ text: '🏠 Main', callback_data: 'main|' });
      }

      if (navButtons.length > 0) {
        buttons.push(navButtons);
      }

      // Send menu
      const pathDisplay = currentPath.length > 0 ? currentPath.join(' > ') : 'Main Menu';
      const pageInfo = totalPages > 1 ? ` (Page ${page + 1}/${totalPages})` : '';
      
      await bot.sendMessage(chatId, `📂 ${pathDisplay}${pageInfo}`, {
        reply_markup: { inline_keyboard: buttons }
      });

    } catch (error) {
      this.logger.error('Error sending folder menu:', error);
      try {
        await bot.sendMessage(chatId, '❌ Error loading folder menu.');
      } catch (e) {
        this.logger.error('Failed to send error message:', e);
      }
    }
  }

  async sendAdminMessage(botId, ownerId, message) {
    try {
      const botInfo = this.bots.get(botId);
      if (!botInfo) {
        throw new Error('Bot not found');
      }

      // CRITICAL FIX #1: Limit message length
      const sanitizedMessage = this.security.sanitizeInput(message);
      if (!sanitizedMessage || sanitizedMessage.length > 4096) {
        throw new Error('Invalid or too long message');
      }
      
      await botInfo.instance.sendMessage(ownerId, 
        `📨 Message from Administrator:\n\n${sanitizedMessage}`
      );

      return true;
    } catch (error) {
      this.logger.error(`Error sending admin message:`, error);
      throw error;
    }
  }

  // BM-11: Enhanced recovery monitor with exponential backoff and transient error handling
  startRecoveryMonitor() {
    this.recoveryInterval = setInterval(async () => {
      for (const [botId, botInfo] of this.bots.entries()) {
        try {
          // Calculate backoff interval for this bot
          const failureCount = botInfo.consecutiveFailures || 0;
          const minInterval = 5 * 60 * 1000; // 5 minutes base
          const backoffInterval = Math.min(minInterval * Math.pow(2, failureCount), 30 * 60 * 1000); // Max 30 min
          
          // Skip if not enough time has passed
          if (Date.now() - (botInfo.lastCheckTime || 0) < backoffInterval) {
            continue;
          }
          
          botInfo.lastCheckTime = Date.now();
          
          // Check if circuit breaker is open
          if (this.isCircuitBreakerOpen(botId)) {
            continue;
          }

          // Check if bot is still responsive
          await botInfo.instance.getMe();
          
          // Success - reset failure count
          botInfo.consecutiveFailures = 0;
          botInfo.errors = [];
          botInfo.lastHealthCheck = Date.now();
          this.recordBotSuccess(botId);
          
        } catch (error) {
          this.logger.error(`Bot ${botId} health check failed:`, error);
          
          // BM-11: Distinguish transient network errors from permanent errors
          const isTransient = error.code === 'ETIMEDOUT' || 
                            error.code === 'ECONNRESET' ||
                            error.code === 'ENOTFOUND';
          
          if (isTransient) {
            // Increment failure count but don't restart immediately
            botInfo.consecutiveFailures = (botInfo.consecutiveFailures || 0) + 1;
            
            // Only restart after 5 consecutive timeouts
            if (botInfo.consecutiveFailures >= 5) {
              this.logger.info(`Bot ${botId} has 5 consecutive failures, attempting restart`);
                                      
              try {
                // BM-17: Await stop and add delay before restart
                await this.stopBot(botId);
                
                // Wait 2 seconds for cleanup
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                const bot = this.storage.getBotById(botId);
                if (bot && bot.status === 'approved') {
                  await this.addBot(
                    botId,
                    bot.botToken,
                    bot.channelId,
                    bot.metadata,
                    bot.status,
                    bot.ownerId
                  );
                  
                  await this.adminBot.sendAlert('recovery', 
                    `Bot ${botId} was automatically restarted after health check failure`
                  );
                }
              } catch (restartError) {
                this.logger.error(`Failed to restart bot ${botId}:`, restartError);
                await this.adminBot.sendAlert('error',
                  `Failed to auto-restart bot ${botId}: ${restartError.message}`
                );
              }
            }
          } else {
            // Permanent error - record and attempt restart
            this.recordBotFailure(botId);
            
            // Track failure
            if (!botInfo.errors) botInfo.errors = [];
            if (botInfo.errors.length < this.MAX_ERROR_HISTORY) {
              botInfo.errors.push({
                timestamp: new Date().toISOString(),
                error: error.message,
                type: 'health_check'
              });
            }

            // If failed multiple times and not in circuit breaker, attempt restart
            if (botInfo.errors.length >= 3 && !this.isCircuitBreakerOpen(botId)) {
              this.logger.info(`Attempting to restart bot ${botId}...`);
              
              try {
                // BM-17: Await stop and add delay before restart
                await this.stopBot(botId);
                
                // Wait 2 seconds for cleanup
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                const bot = this.storage.getBotById(botId);
                if (bot && bot.status === 'approved') {
                  await this.addBot(
                    botId,
                    bot.botToken,
                    bot.channelId,
                    bot.metadata,
                    bot.status,
                    bot.ownerId
                  );
                  
                  await this.adminBot.sendAlert('recovery', 
                    `Bot ${botId} was automatically restarted after health check failure`
                  );
				}
			  } catch (restartError) {
				this.logger.error(`Failed to restart bot ${botId}:`, restartError);
				await this.adminBot.sendAlert('error',
				  `Failed to auto-restart bot ${botId}: ${restartError.message}`
				);
			  }
            }	
		  }
		}
	  }
    }, 60 * 1000); // Check every minute, but backoff is per-bot
  }

  async stopBot(botId) {
    const botInfo = this.bots.get(botId);
    if (botInfo) {
      try {
        await botInfo.instance.stopPolling();
      } catch (error) {
        this.logger.error(`Error stopping bot ${botId}:`, error);
      }
      
      // BM-13: Clear cache
      this.storage.clearCache(botId);
      
      this.bots.delete(botId);
      this.botTokenMap.delete(botInfo.token);
      this.logger.info(`✓ Bot ${botId} stopped`);
    }
  }

  async stopAllBots() {
    // Clear recovery interval
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
    }
    
    // BM-2: Clear circuit breaker cleanup interval
    if (this.circuitBreakerCleanupInterval) {
      clearInterval(this.circuitBreakerCleanupInterval);
    }
    
    // CRITICAL FIX #5: Save circuit breaker state before shutdown
    await this.saveCircuitBreakerState();
    
    this.logger.info('Stopping all bots...');
    
    // BM-18: Collect all stop promises and wait
    const stopPromises = [];
    
    for (const [botId, botInfo] of this.bots.entries()) {
      const stopPromise = botInfo.instance.stopPolling()
        .catch(error => {
          this.logger.error(`Error stopping bot ${botId}:`, error);
        });
      stopPromises.push(stopPromise);
    }
    
    // Wait for all stops to complete
    await Promise.all(stopPromises);
    
    this.bots.clear();
    this.botTokenMap.clear();
    this.logger.info('✓ All bots stopped');
  }

  getActiveBotCount() {
    return this.bots.size;
  }

  getBotInfo(botId) {
    return this.bots.get(botId);
  }
}

module.exports = BotManager;