import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const requiredEnv = ['MONGODB_URI', 'JWT_SECRET']; // Add required environment variables here in the future
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.error(`🚨 Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

export const env = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',
};
