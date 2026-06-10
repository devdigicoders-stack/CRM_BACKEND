import mongoose from 'mongoose';
import { env } from '../src/config/env.js';

const listCollections = async () => {
  try {
    await mongoose.connect(env.MONGODB_URI || 'mongodb://localhost:27017/crmCRM');
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('\n📦 Database Collections:');
    collections.forEach((c) => console.log(` - ${c.name}`));
    process.exit(0);
  } catch (err) {
    console.error('Error listing collections:', err.message);
    process.exit(1);
  }
};

listCollections();
