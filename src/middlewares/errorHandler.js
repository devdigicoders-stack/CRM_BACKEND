export const errorHandler = (err, req, res, next) => {
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  let message = err.message;

  // Handle Mongoose CastError (e.g., invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ID format. The value "${err.value}" at path "${err.path}" is not a valid ObjectId.`;
  }

  // Handle Mongoose ValidationError
  if (err.name === 'ValidationError') {
    statusCode = 400;
    const messages = Object.values(err.errors).map(el => el.message);
    message = `Validation failed: ${messages.join('. ')}`;
  }

  // Handle MongoDB Duplicate Key Error (code 11000)
  if (err.code === 11000) {
    statusCode = 400;
    const duplicateField = Object.keys(err.keyValue || {})[0] || 'field';
    const duplicateValue = err.keyValue ? err.keyValue[duplicateField] : '';
    message = `Duplicate value error. The value "${duplicateValue}" for field "${duplicateField}" already exists.`;
  }

  res.status(statusCode);
  
  const responseBody = {
    status: 'error',
    message
  };

  // Only include stack trace for internal server errors (5xx) in non-production environments
  if (process.env.NODE_ENV !== 'production' && statusCode >= 500) {
    responseBody.stack = err.stack;
  }

  res.json(responseBody);
};
