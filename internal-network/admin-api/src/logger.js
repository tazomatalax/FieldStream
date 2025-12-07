// Structured logging for FieldStream services
// Provides consistent JSON logs with context for observability

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const SERVICE_NAME = process.env.SERVICE_NAME || 'fieldstream';

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const currentLevel = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.info;

function formatLog(level, message, context = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    message,
    ...context,
  });
}

export const logger = {
  error(message, context = {}) {
    if (currentLevel >= LOG_LEVELS.error) {
      console.error(formatLog('error', message, context));
    }
  },

  warn(message, context = {}) {
    if (currentLevel >= LOG_LEVELS.warn) {
      console.warn(formatLog('warn', message, context));
    }
  },

  info(message, context = {}) {
    if (currentLevel >= LOG_LEVELS.info) {
      console.log(formatLog('info', message, context));
    }
  },

  debug(message, context = {}) {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.log(formatLog('debug', message, context));
    }
  },

  trace(message, context = {}) {
    if (currentLevel >= LOG_LEVELS.trace) {
      console.log(formatLog('trace', message, context));
    }
  },

  // Specialized loggers with pre-filled context
  child(baseContext) {
    return {
      error: (msg, ctx = {}) => logger.error(msg, { ...baseContext, ...ctx }),
      warn: (msg, ctx = {}) => logger.warn(msg, { ...baseContext, ...ctx }),
      info: (msg, ctx = {}) => logger.info(msg, { ...baseContext, ...ctx }),
      debug: (msg, ctx = {}) => logger.debug(msg, { ...baseContext, ...ctx }),
      trace: (msg, ctx = {}) => logger.trace(msg, { ...baseContext, ...ctx }),
    };
  },
};

// Audit logger for security-relevant events
export const auditLogger = {
  log(action, context = {}) {
    console.log(formatLog('audit', action, {
      audit: true,
      ...context,
    }));
  },

  // Specific audit events
  authSuccess(userId, method, context = {}) {
    this.log('AUTH_SUCCESS', {
      event: 'authentication',
      userId,
      method,
      success: true,
      ...context,
    });
  },

  authFailure(method, reason, context = {}) {
    this.log('AUTH_FAILURE', {
      event: 'authentication',
      method,
      reason,
      success: false,
      ...context,
    });
  },

  tokenIssued(tenantId, deviceId, jti, context = {}) {
    this.log('TOKEN_ISSUED', {
      event: 'token',
      action: 'issue',
      tenantId,
      deviceId,
      jti,
      ...context,
    });
  },

  tokenRevoked(tenantId, deviceId, jti, context = {}) {
    this.log('TOKEN_REVOKED', {
      event: 'token',
      action: 'revoke',
      tenantId,
      deviceId,
      jti,
      ...context,
    });
  },

  resourceCreated(resourceType, resourceId, context = {}) {
    this.log('RESOURCE_CREATED', {
      event: 'resource',
      action: 'create',
      resourceType,
      resourceId,
      ...context,
    });
  },

  resourceDeleted(resourceType, resourceId, context = {}) {
    this.log('RESOURCE_DELETED', {
      event: 'resource',
      action: 'delete',
      resourceType,
      resourceId,
      ...context,
    });
  },

  accessDenied(userId, resource, action, context = {}) {
    this.log('ACCESS_DENIED', {
      event: 'authorization',
      userId,
      resource,
      action,
      ...context,
    });
  },

  connectionEvent(eventType, connectionId, context = {}) {
    this.log(`CONNECTION_${eventType.toUpperCase()}`, {
      event: 'connection',
      eventType,
      connectionId,
      ...context,
    });
  },
};

// Express middleware for request logging
export function requestLogger(req, res, next) {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] || generateRequestId();
  
  // Add request ID to request for downstream use
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  
  // Create child logger with request context
  req.log = logger.child({
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
  });
  
  // Log request
  req.log.info('Request started');
  
  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    const logContext = {
      statusCode: res.statusCode,
      duration,
      contentLength: res.get('Content-Length'),
    };
    
    if (res.statusCode >= 500) {
      req.log.error('Request failed', logContext);
    } else if (res.statusCode >= 400) {
      req.log.warn('Request error', logContext);
    } else {
      req.log.info('Request completed', logContext);
    }
  });
  
  next();
}

function generateRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}

export default logger;
