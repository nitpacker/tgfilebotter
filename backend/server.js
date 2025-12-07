// server.js - Main Backend Server Entry Point (PRODUCTION-READY WITH ALL FIXES APPLIED)
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const path = require('path');
const crypto = require('crypto');

const BotManager = require('./bot-manager');
const Storage = require('./storage');
const Security = require('./security');
const Config = require('./config');
const AdminBot = require('./admin-bot');
const AdminRoutes = require('./admin-routes');

const app = express();
const PORT = parseInt(process.env.PORT) || 3000;
const SERVER_TIMEOUT = parseInt(process.env.SERVER_TIMEOUT || '120000');
const KEEP_ALIVE_TIMEOUT = parseInt(process.env.KEEP_ALIVE_TIMEOUT || '65000');
const HEADERS_TIMEOUT = parseInt(process.env.HEADERS_TIMEOUT || '66000');

// Initialize core components
const storage = new Storage();
const security = new Security();
const config = new Config(storage);
const adminBot = new AdminBot(config, storage);
const botManager = new BotManager(storage, config, adminBot);

// Initialize admin routes
const adminRoutes = new AdminRoutes(storage, config, botManager, adminBot, security);

// FIX [S-8]: Request ID generation middleware for distributed tracing
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  next();
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// FIX [S-11]: Missing Compression Middleware
app.use(compression());

// Trust proxy
app.set('trust proxy', 1);

// Request size limits with DoS protection
app.use(express.json({ 
  limit: '15mb',
  verify: (req, res, buf, encoding) => {
    try {
      const body = buf.toString(encoding || 'utf8');
      const depth = (body.match(/{/g) || []).length;
      if (depth > 100) {
        throw new Error('JSON too deeply nested');
      }
      if (/"[^"]{100000,}"/.test(body)) {
        throw new Error('JSON contains extremely long strings');
      }
    } catch (error) {
      throw error;
    }
  }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

// Rate limiting - Global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`[${req.id}] Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

// Rate limiting - Upload endpoint
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Upload rate limit exceeded. Please try again later.',
  standardHeaders: true,
  handler: (req, res) => {
    console.log(`[${req.id}] Upload rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: 'Upload rate limit exceeded',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

// FIX [S-1]: Rate limit for detailed health check endpoint
const healthDetailedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many health check requests.',
  standardHeaders: true
});

// Metadata endpoint rate limiter
const metadataLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many metadata requests.',
  standardHeaders: true
});

app.use(globalLimiter);

// PUBLIC ROUTES
app.get('/health', (req, res) => {
  console.log(`[${req.id}] Health check from ${req.ip}`);
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// FIX [S-1]: Detailed health check with authentication and rate limiting
app.get('/api/health/detailed', healthDetailedLimiter, async (req, res) => {
  const token = req.query.token;
  
  // Generate token on first startup or use env variable
  if (!global.HEALTH_CHECK_TOKEN) {
    global.HEALTH_CHECK_TOKEN = process.env.HEALTH_CHECK_TOKEN || 
      crypto.randomBytes(16).toString('hex');
    if (!process.env.HEALTH_CHECK_TOKEN) {
      console.log(`[${req.id}] Generated health check token: ${global.HEALTH_CHECK_TOKEN}`);
      console.log('  Set HEALTH_CHECK_TOKEN in .env for persistent access');
    }
  }
  
  if (token !== global.HEALTH_CHECK_TOKEN) {
    console.log(`[${req.id}] Unauthorized health check attempt from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {}
  };

  try {
    health.checks.botManager = {
      status: botManager.getActiveBotCount() >= 0 ? 'ok' : 'error',
      activeBots: botManager.getActiveBotCount()
    };

    try {
      const bots = storage.getAllBots();
      health.checks.storage = {
        status: 'ok',
        totalBots: bots.length
      };
    } catch (error) {
      console.error(`[${req.id}] Storage check failed:`, error);
      health.checks.storage = {
        status: 'error',
        error: 'Storage check failed'
      };
      health.status = 'degraded';
    }

    health.checks.adminBot = {
      status: adminBot.isConfigured() ? 'ok' : 'not_configured'
    };

    const memUsage = process.memoryUsage();
    health.checks.memory = {
      status: memUsage.heapUsed < memUsage.heapTotal * 0.9 ? 'ok' : 'warning',
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
    };

    console.log(`[${req.id}] Detailed health check completed`);
    res.json(health);
  } catch (error) {
    console.error(`[${req.id}] Health check error:`, error);
    res.status(500).json({
      status: 'error',
      error: 'Health check failed'
    });
  }
});

// Serve admin panel
app.get('/admin', (req, res) => {
  console.log(`[${req.id}] Admin panel access from ${req.ip}`);
  res.sendFile(path.join(__dirname, 'public', 'admin-panel.html'));
});

// API ROUTES
app.get('/api/csrf-token', (req, res) => {
  const token = crypto.randomBytes(32).toString('hex');
  console.log(`[${req.id}] CSRF token generated for ${req.ip}`);
  res.json({ csrfToken: token });
});

// FIX [S-9]: Bot metadata upload endpoint with idempotency support
app.post('/api/upload',
  uploadLimiter,
  [
    body('botToken')
      .trim()
      .notEmpty().withMessage('Bot token is required')
      .isLength({ max: 100 }).withMessage('Bot token too long')
      .matches(/^\d{8,10}:[A-Za-z0-9_-]{35}$/).withMessage('Invalid bot token format'),
    body('channelId')
      .trim()
      .notEmpty().withMessage('Channel ID is required')
      .isLength({ max: 50 }).withMessage('Channel ID too long')
      .matches(/^(@[a-zA-Z0-9_]{5,32}|-100\d{10,})$/).withMessage('Invalid channel ID format'),
    body('botUsername')
      .trim()
      .notEmpty().withMessage('Bot username is required')
      .matches(/^@[a-zA-Z0-9_]{5,32}$/).withMessage('Invalid bot username format'),
    body('metadata')
      .isObject().withMessage('Metadata must be an object')
      .custom((value) => {
        if (!value.hasOwnProperty('subfolders') || !value.hasOwnProperty('files')) {
          throw new Error('Invalid metadata structure');
        }
        return true;
      })
  ],
  async (req, res) => {
    try {
      console.log(`[${req.id}] Upload request from ${req.ip}`);
      
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log(`[${req.id}] Upload validation failed:`, errors.array());
        await adminBot.sendAlert('security', `Invalid upload attempt from IP: ${req.ip}`);
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid input data',
          details: errors.array().map(e => e.msg)
        });
      }

      const { botToken, channelId, botUsername, metadata } = req.body;

      const sanitizedToken = security.sanitizeInput(botToken);
      const sanitizedChannelId = security.sanitizeInput(channelId);
      const sanitizedUsername = security.sanitizeInput(botUsername);

      if (!sanitizedToken || !sanitizedChannelId || !sanitizedUsername) {
        console.log(`[${req.id}] Input sanitization failed`);
        return res.status(400).json({
          success: false,
          error: 'Input sanitization failed'
        });
      }

      const metadataSize = JSON.stringify(metadata).length;
      const maxSize = config.getMaxJsonSize();
      
      if (metadataSize > maxSize) {
        console.log(`[${req.id}] Metadata too large: ${metadataSize} bytes`);
        return res.status(413).json({
          success: false,
          error: `JSON metadata too large. Maximum: ${maxSize / 1024 / 1024}MB, Yours: ${(metadataSize / 1024 / 1024).toFixed(2)}MB`
        });
      }

      const sanitizedMetadata = security.sanitizeJSON(metadata);
      if (!sanitizedMetadata) {
        console.log(`[${req.id}] Malicious JSON detected from ${req.ip}`);
        await adminBot.sendAlert('security', `Malicious JSON detected from IP: ${req.ip}`);
		return res.status(400).json({
          success: false,
          error: 'Invalid or potentially malicious JSON structure detected'
        });
      }

	  const depth = calculateDepth(sanitizedMetadata);
	  if (depth > 50) {
		return res.status(400).json({
		  success: false,
		  error: 'Folder structure exceeds maximum depth (50 levels)'
		});
	  }

      const folderValidation = security.validateFolderStructure(sanitizedMetadata);
      if (!folderValidation.valid) {
        console.log(`[${req.id}] Invalid folder structure:`, folderValidation.errors);
        return res.status(400).json({
          success: false,
          error: 'Invalid folder structure',
          details: folderValidation.errors.map(e => e.error)
        });
      }

      // FIX [S-9]: Generate idempotency key
      const idempotencyKey = crypto.createHash('sha256')
        .update(sanitizedToken + JSON.stringify(sanitizedMetadata))
        .digest('hex');
      
      // Check idempotency cache
      if (!global.idempotencyCache) {
        global.idempotencyCache = new Map();
      }
      
      const cachedResult = global.idempotencyCache.get(idempotencyKey);
      if (cachedResult && Date.now() - cachedResult.timestamp < 3600000) {
        console.log(`[${req.id}] Returning cached result for idempotent request`);
        return res.json(cachedResult.response);
      }

      const existingBot = storage.getBotByToken(sanitizedToken);
      const isUpdate = !!existingBot;

      let responseData;

      if (isUpdate) {
        const changePercentage = storage.calculateChangePercentage(
          existingBot.metadata,
          sanitizedMetadata
        );

        console.log(`[${req.id}] Updating bot ${sanitizedUsername} (${changePercentage.toFixed(1)}% changes)`);

        if (changePercentage > 30) {
          await adminBot.sendAlert('update', 
            `Bot ${sanitizedUsername} updated with ${changePercentage.toFixed(1)}% changes. Review recommended.`
          );
        }

        storage.updateBot(sanitizedToken, {
          metadata: sanitizedMetadata,
          lastUpdate: new Date().toISOString(),
          changePercentage
        });

        responseData = {
          success: true,
          message: 'Bot metadata updated successfully',
          isUpdate: true,
          changePercentage
        };
      } else {
        const botId = storage.createBot({
          botToken: sanitizedToken,
          channelId: sanitizedChannelId,
          botUsername: sanitizedUsername,
          metadata: sanitizedMetadata,
          status: 'pending',
          createdAt: new Date().toISOString()
        });

        console.log(`[${req.id}] New bot created: ${sanitizedUsername} (ID: ${botId})`);

        await botManager.addBot(botId, sanitizedToken, sanitizedChannelId, sanitizedMetadata);

        await adminBot.sendAlert('new_bot', 
          `New bot created: ${sanitizedUsername}\nBot ID: ${botId}\nStatus: Pending approval`
        );

        responseData = {
          success: true,
          message: 'Bot created successfully. Awaiting admin approval.',
          botId,
          status: 'pending'
        };
      }

      // FIX [S-9]: Cache the result with 1-hour expiry
      global.idempotencyCache.set(idempotencyKey, {
        response: responseData,
        timestamp: Date.now()
      });

      // FIX [S-9]: Cleanup old cache entries to prevent memory leaks
      if (global.idempotencyCache.size > 1000) {
        const now = Date.now();
        for (const [key, value] of global.idempotencyCache.entries()) {
          if (now - value.timestamp > 3600000) {
            global.idempotencyCache.delete(key);
          }
        }
      }

      return res.json(responseData);

    } catch (error) {
      console.error(`[${req.id}] Upload error:`, error);
      await adminBot.sendAlert('error', `Upload endpoint error: ${error.message}`);
      
      return res.status(500).json({
        success: false,
        error: 'Internal server error during upload'
      });
    }
  }
);

// Bot status check endpoint
app.get('/api/bot-status/:botToken', async (req, res) => {
  try {
    console.log(`[${req.id}] Bot status check from ${req.ip}`);
    
    const botToken = security.sanitizeInput(req.params.botToken);
    
    if (!botToken || !security.isValidBotToken(botToken)) {
      console.log(`[${req.id}] Invalid bot token format`);
      return res.status(400).json({
        success: false,
        error: 'Invalid bot token format'
      });
    }
    
    const bot = storage.getBotByToken(botToken);

    if (!bot) {
      console.log(`[${req.id}] Bot not found`);
      return res.status(404).json({
        success: false,
        error: 'Bot not found'
      });
    }

    console.log(`[${req.id}] Bot status: ${bot.status}`);
    return res.json({
      success: true,
      status: bot.status,
      botId: bot.id,
      botUsername: bot.botUsername,
      createdAt: bot.createdAt,
      ownerRegistered: !!bot.ownerId
    });

  } catch (error) {
    console.error(`[${req.id}] Status check error:`, error);
    return res.status(500).json({
      success: false,
      error: 'Error checking bot status'
    });
  }
});

// Bot metadata endpoint with rate limiting
app.get('/api/bot-metadata/:botToken', metadataLimiter, async (req, res) => {
  try {
    console.log(`[${req.id}] Metadata fetch from ${req.ip}`);
    
    const botToken = security.sanitizeInput(req.params.botToken);
    
    if (!botToken || !security.isValidBotToken(botToken)) {
      console.log(`[${req.id}] Invalid bot token format`);
      return res.status(400).json({
        success: false,
        error: 'Invalid bot token format'
      });
    }
    
    const bot = storage.getBotByToken(botToken);

    if (!bot) {
      console.log(`[${req.id}] Bot not found`);
      return res.status(404).json({
        success: false,
        error: 'Bot not found'
      });
    }

    console.log(`[${req.id}] Metadata fetched for bot ${bot.botUsername}`);
    return res.json({
      success: true,
      botId: bot.id,
      status: bot.status,
      metadata: bot.metadata,
      lastUpdate: bot.lastUpdate,
      createdAt: bot.createdAt
    });

  } catch (error) {
    console.error(`[${req.id}] Metadata fetch error:`, error);
    return res.status(500).json({
      success: false,
      error: 'Error fetching bot metadata'
    });
  }
});

// ADMIN ROUTES
app.use('/api/admin', adminRoutes.getRouter());

// ERROR HANDLING
app.use((req, res) => {
  console.log(`[${req.id}] 404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: 'Not found'
  });
});

app.use((err, req, res, next) => {
  console.error(`[${req.id}] Unhandled error:`, err);
  
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  adminBot.sendAlert('error', `Unhandled server error: ${err.message}`).catch(console.error);
  
  res.status(500).json({
    success: false,
    error: isDevelopment ? err.message : 'Internal server error',
    ...(isDevelopment && { stack: err.stack })
  });
});

// SERVER INITIALIZATION

// Environment validation before startup
function validateEnvironment() {
  const errors = [];
  
  if (!process.env.ADMIN_USERNAME) {
    errors.push('ADMIN_USERNAME not set');
  }
  
  if (!process.env.ADMIN_PASSWORD) {
    errors.push('ADMIN_PASSWORD not set');
  } else if (process.env.ADMIN_PASSWORD.length < 12) {
    errors.push('ADMIN_PASSWORD must be at least 12 characters');
  }
  
  if (!process.env.PASSWORD_SALT) {
    errors.push('PASSWORD_SALT not set (required for password hashing)');
  } else if (process.env.PASSWORD_SALT.length < 32) {
    errors.push('PASSWORD_SALT must be at least 32 characters');
  }
  
  if (process.env.ADMIN_PASSWORD && !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/.test(process.env.ADMIN_PASSWORD)) {
    console.warn('⚠ WARNING: ADMIN_PASSWORD should contain uppercase, lowercase, number, and special character');
  }
  
  const port = process.env.PORT || 3000;
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a valid number between 1-65535');
  }
  
  if (errors.length > 0) {
    console.error('\n❌ ENVIRONMENT VALIDATION FAILED:\n');
    errors.forEach(err => console.error(`  - ${err}`));
    console.error('\nPlease set required environment variables and restart.\n');
    process.exit(1);
  }
  
  console.log('✓ Environment variables validated');
}

let server;
let isShuttingDown = false;

async function startServer() {
  try {
    validateEnvironment();
    
    await config.initialize();
    await botManager.loadAllBots();
    await adminBot.initialize();
    
    console.log('✓ Configuration loaded');
    console.log('✓ Bots loaded and initialized');
    console.log('✓ Admin bot ready');

    server = app.listen(PORT, () => {
      console.log(`\n🚀 Server running on port ${PORT}`);
      console.log(`📊 Active bots: ${botManager.getActiveBotCount()}`);
      console.log(`⏰ Started at: ${new Date().toISOString()}\n`);
      
      adminBot.sendAlert('system', 
        `Server started successfully\nActive bots: ${botManager.getActiveBotCount()}\nPort: ${PORT}`
      ).catch(console.error);
    });

    // FIX [S-5]: Use configurable timeout values from environment
    server.timeout = SERVER_TIMEOUT;
    server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT;
    server.headersTimeout = HEADERS_TIMEOUT;

    console.log(`✓ Server timeouts configured (timeout: ${SERVER_TIMEOUT}ms, keepAlive: ${KEEP_ALIVE_TIMEOUT}ms, headers: ${HEADERS_TIMEOUT}ms)`);

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n⚠️  ${signal} received, initiating graceful shutdown...`);
  
  if (server) {
    server.close(() => {
      console.log('✓ HTTP server closed');
    });
  }

  const forceTimeout = setTimeout(() => {
    console.error('❌ Forced shutdown due to timeout');
    process.exit(1);
  }, 30000);

  try {
    if (adminRoutes && adminRoutes.saveSessions) {
      await adminRoutes.saveSessions();
      console.log('✓ Sessions saved');
    }

    await botManager.stopAllBots();
    console.log('✓ All bots stopped');

    await adminBot.sendAlert('system', `Server shutting down (${signal})`);
    console.log('✓ Admin notification sent');

    clearTimeout(forceTimeout);
    console.log('✓ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  adminBot.sendAlert('error', `Uncaught exception: ${error.message}`).catch(console.error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  adminBot.sendAlert('error', `Unhandled rejection: ${reason}`).catch(console.error);
});

// FIX [S-9]: Periodic cleanup of idempotency cache
setInterval(() => {
  if (global.idempotencyCache) {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, value] of global.idempotencyCache.entries()) {
      if (now - value.timestamp > 3600000) {
        global.idempotencyCache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`Cleaned ${cleaned} expired idempotency cache entries`);
    }
  }
}, 600000); // Every 10 minutes

startServer();

module.exports = app;