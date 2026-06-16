import mongoose from 'mongoose';
import { Lead } from './src/models/Lead.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const totalLeads = await Lead.countDocuments();
  const transferred = await Lead.countDocuments({ transferredToInstallation: true });
  const completed = await Lead.countDocuments({ transferredToInstallation: true, installationStatus: 'completed' });
  const pending = await Lead.countDocuments({ transferredToInstallation: true, installationStatus: { $in: ['assigned', 'in_progress'] } });
  console.log(`Total Leads: ${totalLeads}`);
  console.log(`Transferred to Installation: ${transferred}`);
  console.log(`Completed Installations: ${completed}`);
  console.log(`Pending Installations: ${pending}`);
  
  // also check if any records have transferredToInstallation=true
  process.exit(0);
}
run();
