// admin-bot.js - Admin Notification Bot (PRODUCTION-READY - ALL FIXES APPLIED)
const TelegramBot = require('node-telegram-bot-api');

class AdminBot {
  constructor(config, storage) {
    this.config = config;
    this.storage = storage;
    this.bot = null;
    this.adminChannelId = null;
    this.isInitialized = false;
  }

  // CRITICAL FIX #AB-2: Sanitize token for safe logging
  sanitizeToken(token) {
    if (!token || token.length < 12) return '****';
    return token.substring(0, 4) + '...' + token.substring(token.length - 4);
  }

  // CRITICAL FIX #AB-4: Escape Markdown special characters
  escapeMarkdown(text) {
    if (!text) return '';
    // Escape all special Markdown characters to prevent injection
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
  }

  // CRITICAL FIX #AB-5: Validate and truncate message length
  validateMessageLength(message) {
    const MAX_LENGTH = 4096;
    if (message.length <= MAX_LENGTH) {
      return { valid: true, message, wasTruncated: false };
    }
    
    // Truncate and indicate truncation
    const truncated = message.substring(0, MAX_LENGTH - 50);
    return { 
      valid: true, 
      message: truncated + '\n\n... (message truncated)',
      wasTruncated: true
    };
  }

  // CRITICAL FIX #AB-1: Add retry logic with exponential backoff
  async initialize(maxRetries = 3) {
    const retryDelays = [0, 5000, 15000]; // immediate, 5s, 15s
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const botToken = this.config.getAdminBotToken();
        const channelId = this.config.getAdminChannelId();

        if (!botToken || !channelId) {
          console.warn('⚠️  Admin bot not configured. Notifications disabled.');
          return false;
        }

        this.bot = new TelegramBot(botToken, { polling: false });
        this.adminChannelId = channelId;
        
        // Test connection
        await this.bot.getMe();
        
        this.isInitialized = true;
        console.log('✓ Admin bot initialized');
        return true;

      } catch (error) {
        // CRITICAL FIX #AB-2: Sanitize token in error messages
        const safeToken = this.sanitizeToken(this.config.getAdminBotToken());
        console.error(`Admin bot initialization attempt ${attempt + 1} failed (token: ${safeToken}):`, error.message);
        
        if (attempt < maxRetries - 1) {
          console.log(`Retrying in ${retryDelays[attempt + 1] / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt + 1]));
        }
      }
    }
    
    console.error('❌ Admin bot initialization failed after all retries');
    this.isInitialized = false;
    return false;
  }

  async sendAlert(type, message) {
    if (!this.isInitialized) {
      console.log('[ADMIN ALERT]', type, ':', message);
      return false;
    }

    try {
      const emoji = this.getEmojiForType(type);
      
      // CRITICAL FIX #AB-4: Escape user input to prevent Markdown injection
      const escapedMessage = this.escapeMarkdown(message);
      const formattedMessage = `${emoji} *${type.toUpperCase()}*\n\n${escapedMessage}\n\n_${new Date().toLocaleString()}_`;

      // CRITICAL FIX #AB-5: Validate message length before sending
      const { message: validMessage, wasTruncated } = this.validateMessageLength(formattedMessage);
      
      if (wasTruncated) {
        console.warn('Admin alert message was truncated due to length limit');
      }

      await this.bot.sendMessage(this.adminChannelId, validMessage, {
        parse_mode: 'Markdown'
      });

      return true;

    } catch (error) {
      console.error('Error sending admin alert:', error);
      console.log('[ADMIN ALERT FAILED]', type, ':', message);
      return false;
    }
  }

  async sendSystemNotification(title, details) {
    if (!this.isInitialized) {
      console.log('[SYSTEM NOTIFICATION]', title, ':', details);
      return false;
    }

    try {
      // CRITICAL FIX #AB-4: Escape user input to prevent Markdown injection
      const escapedTitle = this.escapeMarkdown(title);
      const escapedDetails = this.escapeMarkdown(details);
      const message = `🖥️ *SYSTEM NOTIFICATION*\n\n*${escapedTitle}*\n\n${escapedDetails}\n\n_${new Date().toLocaleString()}_`;

      // CRITICAL FIX #AB-5: Validate message length before sending
      const { message: validMessage, wasTruncated } = this.validateMessageLength(message);
      
      if (wasTruncated) {
        console.warn('System notification was truncated due to length limit');
      }

      await this.bot.sendMessage(this.adminChannelId, validMessage, {
        parse_mode: 'Markdown'
      });

      return true;

    } catch (error) {
      console.error('Error sending system notification:', error);
      return false;
    }
  }

  async sendBackupReport(backupResult) {
    if (!this.isInitialized) {
      console.log('[BACKUP REPORT]', backupResult);
      return false;
    }

    try {
      let message;
      
      if (backupResult.success) {
        // CRITICAL FIX #AB-4: Escape dynamic data (checksum, paths)
        const escapedLocation = this.escapeMarkdown(backupResult.backupDir || 'Unknown');
        const checksumPreview = backupResult.manifest?.checksum 
          ? this.escapeMarkdown(backupResult.manifest.checksum.substring(0, 16) + '...') 
          : 'N/A';
        
        message = `✅ *BACKUP SUCCESSFUL*\n\n` +
                 `Timestamp: ${this.escapeMarkdown(backupResult.manifest?.timestamp || 'Unknown')}\n` +
                 `Bots backed up: ${backupResult.manifest?.botCount || 0}\n` +
                 `Checksum: \`${checksumPreview}\`\n\n` +
                 `Location: ${escapedLocation}\n\n` +
                 `_${new Date().toLocaleString()}_`;
      } else {
        // CRITICAL FIX #AB-4: Escape error messages
        const escapedError = this.escapeMarkdown(backupResult.error || 'Unknown error');
        message = `❌ *BACKUP FAILED*\n\n` +
                 `Error: ${escapedError}\n\n` +
                 `_${new Date().toLocaleString()}_`;
      }

      // CRITICAL FIX #AB-5: Validate message length before sending
      const { message: validMessage, wasTruncated } = this.validateMessageLength(message);
      
      if (wasTruncated) {
        console.warn('Backup report was truncated due to length limit');
      }

      await this.bot.sendMessage(this.adminChannelId, validMessage, {
        parse_mode: 'Markdown'
      });

      return true;

    } catch (error) {
      console.error('Error sending backup report:', error);
      return false;
    }
  }

  async sendSecurityAlert(severity, eventType, details) {
    if (!this.isInitialized) {
      console.log('[SECURITY ALERT]', severity, eventType, ':', details);
      return false;
    }

    try {
      const emoji = severity === 'HIGH' ? '🚨' : severity === 'MEDIUM' ? '⚠️' : 'ℹ️';
      
      // CRITICAL FIX #AB-4: Escape user input (eventType and details)
      const escapedEventType = this.escapeMarkdown(eventType);
      const escapedDetails = this.escapeMarkdown(details);
      
      const message = `${emoji} *SECURITY ALERT - ${severity}*\n\n` +
                     `Type: ${escapedEventType}\n` +
                     `Details: ${escapedDetails}\n\n` +
                     `_${new Date().toLocaleString()}_`;

      // CRITICAL FIX #AB-5: Validate message length before sending
      const { message: validMessage, wasTruncated } = this.validateMessageLength(message);
      
      if (wasTruncated) {
        console.warn('Security alert was truncated due to length limit');
      }

      await this.bot.sendMessage(this.adminChannelId, validMessage, {
        parse_mode: 'Markdown'
      });

      return true;

    } catch (error) {
      console.error('Error sending security alert:', error);
      return false;
    }
  }

  async sendDailyReport(stats) {
    if (!this.isInitialized) {
      console.log('[DAILY REPORT]', stats);
      return false;
    }

    try {
      // CRITICAL FIX #AB-4: Escape all stats values (convert to string first, then escape)
      // Numbers are safe but we convert to string for consistency
      const message = `📊 *DAILY REPORT*\n\n` +
                     `Total Bots: ${this.escapeMarkdown(String(stats.totalBots || 0))}\n` +
                     `Approved: ${this.escapeMarkdown(String(stats.approved || 0))}\n` +
                     `Pending: ${this.escapeMarkdown(String(stats.pending || 0))}\n` +
                     `Disconnected: ${this.escapeMarkdown(String(stats.disconnected || 0))}\n` +
                     `Banned Users: ${this.escapeMarkdown(String(stats.bannedUsers || 0))}\n\n` +
                     `New Bots Today: ${this.escapeMarkdown(String(stats.newBotsToday || 0))}\n` +
                     `Updates Today: ${this.escapeMarkdown(String(stats.updatesToday || 0))}\n\n` +
                     `_${new Date().toLocaleString()}_`;

      // CRITICAL FIX #AB-5: Validate message length before sending
      const { message: validMessage, wasTruncated } = this.validateMessageLength(message);
      
      if (wasTruncated) {
        console.warn('Daily report was truncated due to length limit');
      }

      await this.bot.sendMessage(this.adminChannelId, validMessage, {
        parse_mode: 'Markdown'
      });

      return true;

    } catch (error) {
      console.error('Error sending daily report:', error);
      return false;
    }
  }

  getEmojiForType(type) {
    const emojiMap = {
      'new_bot': '🤖',
      'approval': '✅',
      'update': '🔄',
      'security': '🔒',
      'error': '❌',
      'system': '🖥️',
      'registration': '📝',
      'backup': '💾',
      'warning': '⚠️',
      'ddos': '🚨',
      'injection': '⚠️'
    };

    return emojiMap[type] || 'ℹ️';
  }

  async testConnection() {
    if (!this.isInitialized) {
      return { success: false, error: 'Admin bot not initialized' };
    }

    try {
      const me = await this.bot.getMe();
      await this.sendAlert('system', 'Admin bot connection test successful!');
      
      return { 
        success: true, 
        botUsername: me.username,
        botId: me.id
      };

    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  isConfigured() {
    return this.isInitialized;
  }
}

module.exports = AdminBot;