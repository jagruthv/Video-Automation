'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');

let isConnected = false;

/**
 * Connect to MongoDB Atlas.
 * Uses connection pooling and retries on failure.
 * @returns {Promise<void>}
 */
async function connectToMongoDB() {
  if (isConnected) {
    logger.info('MongoDB already connected, reusing connection');
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  try {
    await mongoose.connect(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      w: 'majority'
    });
    isConnected = true;
    logger.info('MongoDB connected successfully');
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    throw err;
  }

  mongoose.connection.on('error', (err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
    isConnected = false;
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
    isConnected = false;
  });
}

/**
 * Gracefully disconnect from MongoDB.
 * @returns {Promise<void>}
 */
async function disconnectMongoDB() {
  if (!isConnected) return;
  try {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('MongoDB disconnected gracefully');
  } catch (err) {
    logger.warn(`MongoDB disconnect error: ${err.message}`);
  }
}

module.exports = { connectToMongoDB, disconnectMongoDB };
