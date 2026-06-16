import axios from 'axios';

async function run() {
  try {
    // We can't easily get a token without logging in.
    // Let me just login as an admin or superadmin to get a token.
    // Or I can modify the backend code temporarily to allow no auth for this endpoint?
    // No, let's login.
    const loginRes = await axios.post('http://localhost:5001/api/v1/auth/login', {
      email: 'admin@crm.com', // wait, is it superadmin@crm.com? I'll check db
      password: 'password123'
    });
    console.log(loginRes.data);
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
}
run();
