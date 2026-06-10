import mongoose from 'mongoose';

export const getHealth = (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';

  res.status(200).json({
    status: 'success',
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    server: 'https://crm-backend-sfc6.onrender.com',
    database: dbStatus,
  });
};
