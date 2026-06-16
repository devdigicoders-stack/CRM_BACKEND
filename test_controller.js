import mongoose from 'mongoose';
import { getComprehensiveReport } from './src/controllers/reportController.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const req = {
    user: { role: 'superAdmin', id: 'fake' },
    query: {}
  };
  
  const res = {
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      console.log('API Response:', JSON.stringify(data, null, 2));
    }
  };
  
  const next = (err) => console.error('Error:', err);
  
  await getComprehensiveReport(req, res, next);
  process.exit(0);
}
run();
