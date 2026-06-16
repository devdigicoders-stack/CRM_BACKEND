import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  try {
    // 1. Login as superadmin to get token
    const loginRes = await axios.post('http://localhost:5001/api/v1/auth/login', {
      email: 'superadmin@crm.com', // wait, do I know the email? I can check the Admin collection.
      password: 'password123' 
    });
    // wait I don't know the password
  } catch (err) {
    console.log(err.message);
  }
}
run();
