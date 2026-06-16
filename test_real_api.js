import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Admin } from './src/models/Admin.js';
dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const superadmin = await Admin.findOne({ role: 'superAdmin' });
    if (!superadmin) {
      console.log('No superadmin found');
      process.exit(1);
    }
    
    const token = jwt.sign({ id: superadmin._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    
    const res = await fetch('http://localhost:5001/api/v1/reports/analytics', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const data = await res.json();
    console.log(JSON.stringify(data.data.thisMonth, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
run();
