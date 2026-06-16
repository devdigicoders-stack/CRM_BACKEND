import mongoose from 'mongoose';
import { Lead } from './src/models/Lead.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const leads = await Lead.find({ transferredToInstallation: true }).select('createdAt name installationStatus');
  console.log(leads);
  process.exit(0);
}
run();
