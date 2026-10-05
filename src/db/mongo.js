const mongoose = require('mongoose');
const config = require('../config');
const logger = require('../utils/logger');

let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  try {
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      heartbeatFrequencyMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 2,
    });

    isConnected = true;
    logger.info('MongoDB connected successfully');
  } catch (error) {
    isConnected = false;
    logger.error('MongoDB connection error:', error.message);
    console.log('⏳ Retrying connection in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
};

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  logger.warn('MongoDB disconnected. Reconnecting...');
  setTimeout(connectDB, 5000);
});

mongoose.connection.on('error', (err) => {
  isConnected = false;
  logger.error('MongoDB error:', err.message);
});

module.exports = { connectDB };