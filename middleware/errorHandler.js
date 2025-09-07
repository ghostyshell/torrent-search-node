/**
 * Production-ready error handling middleware
 * Provides consistent error responses and logging
 */

const logger = require('./logger');
const { config } = require('../config/environment');

/**
 * Custom error class for API errors
 */
class ApiError extends Error {
  constructor(message, statusCode = 500, code = null, details = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}

/**
 * Error handler middleware
 */
function errorHandler(err, req, res, next) {
  // Default error properties
  let statusCode = 500;
  let message = 'Internal Server Error';
  let code = 'INTERNAL_ERROR';
  let details = null;

  // Handle different error types
  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    code = err.code || 'API_ERROR';
    details = err.details;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
    code = 'VALIDATION_ERROR';
    details = err.message;
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
    code = 'INVALID_ID';
  } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
    statusCode = 503;
    message = 'Service Unavailable';
    code = 'SERVICE_UNAVAILABLE';
    details = 'External service is currently unavailable';
  } else if (err.code === 'ETIMEDOUT') {
    statusCode = 504;
    message = 'Gateway Timeout';
    code = 'TIMEOUT';
    details = 'Request timed out';
  }

  // Log error with context
  const errorContext = {
    error: {
      name: err.name,
      message: err.message,
      stack: config.isDevelopment ? err.stack : undefined,
      code: err.code,
      statusCode,
    },
    request: {
      method: req.method,
      url: req.url,
      headers: config.isDevelopment ? req.headers : undefined,
      body: config.isDevelopment ? req.body : undefined,
      ip: req.ip || req.connection.remoteAddress,
    },
  };

  // Log based on severity
  if (statusCode >= 500) {
    logger.error('Server error occurred', errorContext);
  } else if (statusCode >= 400) {
    logger.warn('Client error occurred', errorContext);
  }

  // Prepare response
  const errorResponse = {
    success: false,
    error: {
      message,
      code,
      statusCode,
    },
    timestamp: new Date().toISOString(),
  };

  // Add details in development or for specific error types
  if (config.isDevelopment || details) {
    errorResponse.error.details =
      details || (config.isDevelopment ? err.stack : undefined);
  }

  // Add request ID if available
  if (req.id) {
    errorResponse.requestId = req.id;
  }

  res.status(statusCode).json(errorResponse);
}

/**
 * 404 handler for unmatched routes
 */
function notFoundHandler(req, res, next) {
  const error = new ApiError(
    `Route ${req.method} ${req.originalUrl} not found`,
    404,
    'ROUTE_NOT_FOUND'
  );
  next(error);
}

/**
 * Async error wrapper to catch async errors
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Validation error helper
 */
function createValidationError(message, field = null) {
  return new ApiError(
    message,
    400,
    'VALIDATION_ERROR',
    field ? { field } : null
  );
}

/**
 * Service unavailable error helper
 */
function createServiceError(service, message = null) {
  return new ApiError(
    message || `${service} service is currently unavailable`,
    503,
    'SERVICE_UNAVAILABLE',
    { service }
  );
}

/**
 * Timeout error helper
 */
function createTimeoutError(operation = 'Operation') {
  return new ApiError(`${operation} timed out`, 504, 'TIMEOUT');
}

module.exports = {
  ApiError,
  errorHandler,
  notFoundHandler,
  asyncHandler,
  createValidationError,
  createServiceError,
  createTimeoutError,
};
