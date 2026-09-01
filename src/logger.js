const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' // ISO 8601 with milliseconds
    }),
    winston.format.errors({ stack: true }), // Capture stack traces
    winston.format.json() // JSON output
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: [], // Force all logs to stdout
      handleExceptions: false // Prevent crashes on logging errors
    })
  ],
  exitOnError: false // Continue on transport errors
});

// Gracefully handle logger errors without crashing the application
logger.on('error', (err) => {
  // Fallback to console if logger fails (should never happen in normal operation)
  console.error('Logger error:', err.message);
});

module.exports = logger;
