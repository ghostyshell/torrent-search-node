const fs = require('fs');
const path = require('path');
const { config } = require('../config/environment');
const jobLogContext = require('../services/jobLogContext');

class Logger {
  constructor() {
    this.logLevel = config.logging.level;
    this.enableConsole = config.logging.enableConsole;
    this.enableFile = config.logging.enableFile;
    this.logDirectory = config.logging.logDir;
    // Rotate each primary log file once it passes this size (default 10MB).
    this.maxLogFileBytes = Math.max(
      1024 * 1024,
      parseInt(process.env.LOG_MAX_FILE_BYTES || String(10 * 1024 * 1024), 10) || 10 * 1024 * 1024
    );

    // Create logs directory if file logging is enabled
    if (this.enableFile && !fs.existsSync(this.logDirectory)) {
      fs.mkdirSync(this.logDirectory, { recursive: true });
    }

    // Log levels (higher number = more verbose)
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
    };
  }

  /**
   * Format log message with timestamp and metadata
   */
  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      environment: config.environment,
      ...meta,
    };

    return JSON.stringify(logEntry);
  }

  /**
   * Write log to console and/or file
   */
  writeLog(level, formattedMessage) {
    const jobSink = jobLogContext.getSink();
    if (jobSink) {
      try {
        jobSink.appendRaw(formattedMessage + '\n');
      } catch {
        // avoid breaking primary logging
      }
    }

    // Console output
    if (this.enableConsole) {
      switch (level) {
        case 'error':
          console.error(formattedMessage);
          break;
        case 'warn':
          console.warn(formattedMessage);
          break;
        default:

      }
    }

    // File output
    if (this.enableFile) {
      const logFile = path.join(this.logDirectory, `${level}.log`);
      const allLogsFile = path.join(this.logDirectory, 'all.log');

      this.appendWithRotation(logFile, formattedMessage + '\n');
      this.appendWithRotation(allLogsFile, formattedMessage + '\n');
    }
  }

  /**
   * Append to a log file, rotating it once it exceeds the size cap so the
   * primary log files never grow without bound. Keeps a single `.1` backup.
   */
  appendWithRotation(filePath, line) {
    try {
      const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      if (stat && stat.size >= this.maxLogFileBytes) {
        // Overwrite the previous backup with the now-full current file.
        fs.renameSync(filePath, `${filePath}.1`);
      }
    } catch {
      // If rotation fails, fall through and keep logging to the existing file.
    }
    fs.appendFileSync(filePath, line);
  }

  /**
   * Check if log level should be output
   */
  shouldLog(level) {
    return this.levels[level] <= this.levels[this.logLevel];
  }

  /**
   * Log error messages
   */
  error(message, meta = {}) {
    if (this.shouldLog('error')) {
      const formatted = this.formatMessage('error', message, meta);
      this.writeLog('error', formatted);
    }
  }

  /**
   * Log warning messages
   */
  warn(message, meta = {}) {
    if (this.shouldLog('warn')) {
      const formatted = this.formatMessage('warn', message, meta);
      this.writeLog('warn', formatted);
    }
  }

  /**
   * Log info messages
   */
  info(message, meta = {}) {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage('info', message, meta);
      this.writeLog('info', formatted);
    }
  }

  /**
   * Log debug messages
   */
  debug(message, meta = {}) {
    if (this.shouldLog('debug')) {
      const formatted = this.formatMessage('debug', message, meta);
      this.writeLog('debug', formatted);
    }
  }

  /**
   * Express middleware for request logging
   */
  requestMiddleware() {
    return (req, res, next) => {
      const startTime = Date.now();

      // Log request
      this.info('Incoming request', {
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip || req.connection.remoteAddress,
        requestId: req.id || null,
      });

      // Log response when finished
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const logLevel = res.statusCode >= 400 ? 'warn' : 'info';

        this[logLevel]('Request completed', {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          contentLength: res.get('Content-Length') || 0,
        });
      });

      next();
    };
  }
}

// Create singleton logger instance
const logger = new Logger();

module.exports = logger;
