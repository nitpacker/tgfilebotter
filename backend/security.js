// security.js
const validator = require('validator');

class Security {
  constructor() {
    // CRITICAL FIX [SEC-1]: Extended dangerous patterns to detect all XSS vectors
    this.dangerousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /<iframe/gi,           // FIXED: Added iframe
      /<object/gi,           // FIXED: Added object
      /<embed/gi,            // FIXED: Added embed
      /<link/gi,             // FIXED: Added link
      /<style/gi,            // FIXED: Added style
      /javascript:/gi,
      /on\w+\s*=/gi,
      /onerror=/gi,          // FIXED: Explicit onerror check
      /onload=/gi,           // FIXED: Explicit onload check
      /eval\(/gi,
      /Function\(/gi,
      /setTimeout\(/gi,
      /setInterval\(/gi,
      /__proto__/gi,
      /constructor/gi,
      /\.\.\/\.\.\//g,       // Path traversal
      /\$\{.*\}/g,           // Template injection
      /`.*`/g,               // Template literals
    ];

    // CRITICAL FIX [SEC-4]: Enhanced folder name regex and added explicit blacklist
    // Allowed characters for folder names (Unicode letters, numbers, spaces, and safe chars)
    this.folderNameRegex = /^[\p{L}\p{N}\s\-_().]+$/u;
    
    // FIXED: Explicit blacklist for shell injection characters
    this.folderNameBlacklist = /[`${}\\]/;
    
    // CRITICAL FIX [SEC-8]: Custom HTML escape map for Unicode preservation
    this.htmlEscapeMap = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#x27;'
    };
    
    // CRITICAL FIX [SEC-10]: Sensitive keys to redact in logs
    this.sensitiveKeys = ['token', 'password', 'secret', 'key', 'salt', 'auth', 'credential', 'api_key', 'apikey'];
  }

  // CRITICAL FIX [SEC-8]: Custom HTML escape that preserves Unicode
  escapeHtml(text) {
    if (typeof text !== 'string') {
      return text;
    }
    return text.replace(/[<>&"']/g, (char) => this.htmlEscapeMap[char]);
  }

  // Sanitize general text input
  sanitizeInput(input) {
    if (typeof input !== 'string') {
      return null;
    }

    try {
      // Trim whitespace
      let sanitized = input.trim();

      // Check length
      if (sanitized.length === 0 || sanitized.length > 10000) {
        return null;
      }

      // Check for dangerous patterns
      for (const pattern of this.dangerousPatterns) {
        if (pattern.test(sanitized)) {
          console.warn('Dangerous pattern detected:', pattern);
          return null;
        }
      }

      // CRITICAL FIX [SEC-8]: Use custom HTML escape instead of validator.escape()
      // This preserves Unicode characters (Arabic, Chinese, etc.) while escaping HTML
      sanitized = this.escapeHtml(sanitized);

      return sanitized;

    } catch (error) {
      console.error('Error sanitizing input:', error);
      return null;
    }
  }

  // Sanitize Telegram messages
  sanitizeTelegramMessage(msg) {
    try {
      if (!msg || typeof msg !== 'object') {
        return null;
      }

      // Check message text
      if (msg.text) {
        const sanitizedText = this.sanitizeInput(msg.text);
        if (sanitizedText === null && msg.text.length > 0) {
          console.warn('Malicious message text detected');
          return null;
        }
      }

      // Check caption
      if (msg.caption) {
        const sanitizedCaption = this.sanitizeInput(msg.caption);
        if (sanitizedCaption === null && msg.caption.length > 0) {
          console.warn('Malicious caption detected');
          return null;
        }
      }

      // Check callback data
      if (msg.data) {
        const sanitizedData = this.sanitizeInput(msg.data);
        if (sanitizedData === null) {
          console.warn('Malicious callback data detected');
          return null;
        }
      }

      return msg;

    } catch (error) {
      console.error('Error sanitizing Telegram message:', error);
      return null;
    }
  }

  // CRITICAL FIX [SEC-11]: Added total key counter to prevent breadth-based DoS
  sanitizeJSON(obj, depth = 0, maxDepth = 10, context = { totalKeys: 0, maxKeys: 10000 }) {
    try {
      // Prevent deep recursion attacks
      if (depth > maxDepth) {
        console.warn('JSON depth exceeded');
        return null;
      }

      // CRITICAL FIX [SEC-11]: Check total key count across entire structure
      if (context.totalKeys > context.maxKeys) {
        console.warn('JSON total key count exceeded - potential DoS attack');
        return null;
      }

      // Check for null/undefined
      if (obj === null || obj === undefined) {
        return null;
      }

      // Handle arrays
      if (Array.isArray(obj)) {
        const sanitizedArray = [];
        for (const item of obj) {
          const sanitized = this.sanitizeJSON(item, depth + 1, maxDepth, context);
          if (sanitized !== null) {
            sanitizedArray.push(sanitized);
          }
        }
        return sanitizedArray;
      }

      // Handle objects
      if (typeof obj === 'object') {
        // Check for prototype pollution
        if (obj.hasOwnProperty('__proto__') || 
            obj.hasOwnProperty('constructor') || 
            obj.hasOwnProperty('prototype')) {
          console.warn('Prototype pollution attempt detected');
          return null;
        }

        const sanitizedObj = {};
        const keys = Object.entries(obj);
        
        // CRITICAL FIX [SEC-11]: Increment total key counter for each key
        context.totalKeys += keys.length;
        
        // Check if we've exceeded the limit after adding these keys
        if (context.totalKeys > context.maxKeys) {
          console.warn(`JSON total key count exceeded at depth ${depth} - potential breadth-based DoS attack`);
          return null;
        }
        
        for (const [key, value] of keys) {
          // Sanitize key
          const sanitizedKey = this.sanitizeInput(key);
          if (sanitizedKey === null) {
            console.warn('Malicious key detected:', key);
            continue;
          }

          // Sanitize value
          if (typeof value === 'string') {
            const sanitizedValue = this.sanitizeInput(value);
            if (sanitizedValue !== null) {
              sanitizedObj[sanitizedKey] = sanitizedValue;
            }
          } else if (typeof value === 'number' || typeof value === 'boolean') {
            sanitizedObj[sanitizedKey] = value;
          } else if (typeof value === 'object') {
            const sanitizedValue = this.sanitizeJSON(value, depth + 1, maxDepth, context);
            if (sanitizedValue !== null) {
              sanitizedObj[sanitizedKey] = sanitizedValue;
            }
          }
        }

        return sanitizedObj;
      }

      // Handle primitives
      if (typeof obj === 'string') {
        return this.sanitizeInput(obj);
      }
      if (typeof obj === 'number' || typeof obj === 'boolean') {
        return obj;
      }

      return null;

    } catch (error) {
      console.error('Error sanitizing JSON:', error);
      return null;
    }
  }

  // Validate folder structure
  validateFolderStructure(metadata) {
    const errors = [];

    try {
      this.validateFolderRecursive(metadata, '', errors);

      return {
        valid: errors.length === 0,
        errors
      };

    } catch (error) {
      console.error('Error validating folder structure:', error);
      return {
        valid: false,
        errors: ['Internal validation error']
      };
    }
  }

  validateFolderRecursive(folder, currentPath, errors) {
    // Validate subfolders
    if (folder.subfolders) {
      for (const [folderName, subfolder] of Object.entries(folder.subfolders)) {
        // Check folder name
        if (!this.isValidFolderName(folderName)) {
          errors.push({
            path: currentPath ? `${currentPath}/${folderName}` : folderName,
            error: 'Invalid folder name. Only letters, numbers, spaces, and -_() are allowed.'
          });
        }

        // Check for path traversal
        if (folderName.includes('..') || folderName.includes('/') || folderName.includes('\\')) {
          errors.push({
            path: currentPath ? `${currentPath}/${folderName}` : folderName,
            error: 'Path traversal attempt detected'
          });
        }

        // Validate recursively
        const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;
        this.validateFolderRecursive(subfolder, newPath, errors);
      }
    }

    // Validate files
    if (folder.files) {
      if (!Array.isArray(folder.files)) {
        errors.push({
          path: currentPath,
          error: 'Files must be an array'
        });
      } else {
        for (const file of folder.files) {
          if (!file.fileId && !file.messageId) {
            errors.push({
              path: currentPath,
              error: 'File missing fileId or messageId'
            });
          }
        }
      }
    }
  }

  // CRITICAL FIX [SEC-4]: Enhanced folder name validation with explicit blacklist
  isValidFolderName(name) {
    if (!name || typeof name !== 'string') {
      return false;
    }

    // Check length
    if (name.length === 0 || name.length > 255) {
      return false;
    }

    // Check for valid characters (Unicode support)
    if (!this.folderNameRegex.test(name)) {
      return false;
    }

    // CRITICAL FIX [SEC-4]: Explicit blacklist check for shell injection characters
    if (this.folderNameBlacklist.test(name)) {
      console.warn('Folder name contains blacklisted characters (backticks, $, {, }, \\):', name);
      return false;
    }

    return true;
  }

  // Rate limiting helper
  createRateLimiter() {
    const requests = new Map();
    const WINDOW_MS = 60000; // 1 minute
    const MAX_REQUESTS = 60;

    return (identifier) => {
      const now = Date.now();
      const userRequests = requests.get(identifier) || [];

      // Remove old requests outside window
      const recentRequests = userRequests.filter(time => now - time < WINDOW_MS);

      if (recentRequests.length >= MAX_REQUESTS) {
        return false; // Rate limit exceeded
      }

      recentRequests.push(now);
      requests.set(identifier, recentRequests);

      // Cleanup old entries periodically
      if (Math.random() < 0.01) { // 1% chance
        for (const [key, times] of requests.entries()) {
          const valid = times.filter(time => now - time < WINDOW_MS);
          if (valid.length === 0) {
            requests.delete(key);
          } else {
            requests.set(key, valid);
          }
        }
      }

      return true; // Request allowed
    };
  }

  // Validate bot token format
  isValidBotToken(token) {
    if (!token || typeof token !== 'string') {
      return false;
    }

    // Telegram bot token format: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
    const tokenRegex = /^\d{8,10}:[A-Za-z0-9_-]{35}$/;
    return tokenRegex.test(token);
  }

  // Validate Telegram channel ID
  isValidChannelId(channelId) {
    if (!channelId || typeof channelId !== 'string') {
      return false;
    }

    // Channel ID format: @channelname or -100123456789
    return /^(@[a-zA-Z0-9_]{5,32}|-100\d{10,})$/.test(channelId);
  }

  // CRITICAL FIX [SEC-10]: Redact sensitive data before logging
  redactSensitiveData(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const redacted = Array.isArray(data) ? [...data] : { ...data };

    for (const key in redacted) {
      if (redacted.hasOwnProperty(key)) {
        // Check if key contains sensitive terms
        const keyLower = key.toLowerCase();
        const isSensitive = this.sensitiveKeys.some(sensitiveKey => 
          keyLower.includes(sensitiveKey)
        );

        if (isSensitive) {
          redacted[key] = '[REDACTED]';
        } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
          // Recursively redact nested objects
          redacted[key] = this.redactSensitiveData(redacted[key]);
        }
      }
    }

    return redacted;
  }

  // CRITICAL FIX [SEC-10]: Log security events with sensitive data redaction
  logSecurityEvent(eventType, details) {
    // Redact sensitive data from details before logging
    const safeDetails = this.redactSensitiveData(details);

    const logEntry = {
      timestamp: new Date().toISOString(),
      type: eventType,
      details: safeDetails,
      severity: this.getEventSeverity(eventType)
    };

    console.log('[SECURITY]', JSON.stringify(logEntry));
    
    // In production, this would write to a secure log file
    // or send to a monitoring service
  }

  getEventSeverity(eventType) {
    const severityMap = {
      'injection_attempt': 'HIGH',
      'malicious_json': 'HIGH',
      'path_traversal': 'HIGH',
      'xss_attempt': 'HIGH',
      'rate_limit': 'MEDIUM',
      'invalid_input': 'LOW',
      'sanitization': 'LOW'
    };

    return severityMap[eventType] || 'MEDIUM';
  }
}

module.exports = Security;