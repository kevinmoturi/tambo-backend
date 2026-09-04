import mongoose from 'mongoose';
import config from './config';

const connectDB = async (): Promise<void> => {
  if (!config.mongodbUri) {
    throw new Error('MONGODB_URI is not set. Cannot start without a database.');
  }

  try {
    await mongoose.connect(config.mongodbUri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
};

export default connectDB;
