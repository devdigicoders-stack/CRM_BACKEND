import mongoose from 'mongoose';
import { Lead } from './src/models/Lead.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const leads = await Lead.aggregate([
    {
      $group: {
        _id: { $month: "$createdAt" },
        count: { $sum: 1 }
      }
    }
  ]);
  
  console.log(leads);
  process.exit(0);
}
run();
