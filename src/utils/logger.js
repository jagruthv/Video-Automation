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
            winston.format.printf(({ timestamp, level, message, module: mod, service, ...rest }) => {
              const modStr = mod ? ` [${mod}]` : '';
              const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
              return `${timestamp} ${level}${modStr}: ${message}${extra}`;
            })
          )
    })
  ]
});

/**
 * Get a module-scoped logger.
 * Returns an object with info/warn/error/debug methods
 * that automatically tag logs with the module name.
 *
 * @param {string} moduleName
 * @returns {{ info: Function, warn: Function, error: Function, debug: Function }}
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
