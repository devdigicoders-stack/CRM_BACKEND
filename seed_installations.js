import mongoose from 'mongoose';
import { Lead } from './src/models/Lead.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Update 5 existing leads to be transferred to installation TODAY
  const leadsToUpdate = await Lead.find({}).limit(5);
  
  for (let i = 0; i < leadsToUpdate.length; i++) {
    const lead = leadsToUpdate[i];
    lead.transferredToInstallation = true;
    if (i < 3) {
      lead.installationStatus = 'completed';
    } else {
      lead.installationStatus = 'in_progress';
    }
    // Update createdAt to today so it shows up in "Today" tab as well!
    lead.createdAt = new Date(); 
    await lead.save();
  }
  
  console.log('Successfully seeded 5 installations (3 completed, 2 in_progress) with today date!');
  process.exit(0);
}
run();
