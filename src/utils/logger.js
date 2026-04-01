'use strict';

const winston = require('winston');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Application logger using Winston.
 * - Production: JSON format for structured logging (GitHub Actions captures stdout)
 * - Development: Colorized human-readable format
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'aura' },
  transports: [
    new winston.transports.Console({
      format: isProduction
        ? winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message, module, ...rest }) => {
              const mod = module ? ` [${module}]` : '';
              const extra = Object.keys(rest).length > 1 ? ` ${JSON.stringify(rest)}` : '';
              return `${timestamp} ${level}${mod}: ${message}${extra}`;
            })
          )
    })
  ]
});

/**
 * Creates a child logger with a fixed module name.
 * @param {string} moduleName - The module name for log context
 * @returns {winston.Logger}
 */
logger.child = function (moduleName) {
  return logger.child ? winston.createLogger({
    ...logger,
    defaultMeta: { ...logger.defaultMeta, module: moduleName }
  }) : logger;
};

/**
 * Get a module-scoped logger.
 * @param {string} moduleName
 * @returns {Object} Logger with module context
 */
function getModuleLogger(moduleName) {
  const wrap = (level) => (message, meta = {}) => {
    logger.log(level, message, { module: moduleName, ...meta });
  };
  return {
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
    debug: wrap('debug')
  };
}

module.exports = logger;
module.exports.getModuleLogger = getModuleLogger;
