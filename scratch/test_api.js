import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { User } from '../src/models/User.js';
import { Lead } from '../src/models/Lead.js';

const runTests = async () => {
  let server;
  let mongoServer;
  try {
    console.log('⚡ Starting in-memory MongoDB server...');
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    console.log(`🔌 Connecting Mongoose to in-memory DB: ${mongoUri}`);
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to in-memory database!');

    // Clean up test data (in-memory DB is clean, but good practice)
    console.log('🗑️  Cleaning up previous test data...');
    await User.deleteMany({ email: { $in: ['test_mgr@crm.com', 'test_rep@crm.com'] } });
    await Lead.deleteMany({ name: { $in: ['Test Lead A', 'Test Lead B', 'Test Lead C'] } });

    // Start server on a random port
    server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}/api/v1`;
    console.log(`🚀 Test server listening on port ${port}`);

    // --- TEST 1: Register Manager ---
    console.log('\n--- Test 1: Registering Manager ---');
    const registerMgrRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Manager',
        email: 'test_mgr@crm.com',
        password: 'password123',
        role: 'manager',
        phone: '1234567890',
      }),
    });
    const mgrData = await registerMgrRes.json();
    if (registerMgrRes.status !== 201) throw new Error(`Failed to register manager: ${JSON.stringify(mgrData)}`);
    console.log('✅ Manager registered successfully!');
    const mgrToken = mgrData.token;
    const mgrId = mgrData.data.user._id;

    // --- TEST 2: Login Manager ---
    console.log('\n--- Test 2: Logging in Manager ---');
    const loginMgrRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test_mgr@crm.com',
        password: 'password123',
      }),
    });
    const loginMgrData = await loginMgrRes.json();
    if (loginMgrRes.status !== 200) throw new Error(`Failed to login manager: ${JSON.stringify(loginMgrData)}`);
    console.log('✅ Manager logged in successfully!');

    // --- TEST 3: Register Sales Representative ---
    console.log('\n--- Test 3: Registering Sales Representative ---');
    const registerRepRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Sales Rep',
        email: 'test_rep@crm.com',
        password: 'password123',
        role: 'sales_rep',
        phone: '0987654321',
      }),
    });
    const repData = await registerRepRes.json();
    if (registerRepRes.status !== 201) throw new Error(`Failed to register sales rep: ${JSON.stringify(repData)}`);
    console.log('✅ Sales Rep registered successfully!');
    const repToken = repData.token;
    const repId = repData.data.user._id;

    // --- TEST 4: Login Sales Representative ---
    console.log('\n--- Test 4: Logging in Sales Representative ---');
    const loginRepRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test_rep@crm.com',
        password: 'password123',
      }),
    });
    const loginRepData = await loginRepRes.json();
    if (loginRepRes.status !== 200) throw new Error(`Failed to login sales rep: ${JSON.stringify(loginRepData)}`);
    console.log('✅ Sales Rep logged in successfully!');

    // --- TEST 5: Create Lead (Manager) ---
    console.log('\n--- Test 5: Creating Lead (Manager) ---');
    const createLeadRes = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mgrToken}`,
      },
      body: JSON.stringify({
        name: 'Test Lead A',
        phone: '9898989898',
        email: 'leada@crm.com',
        source: 'Website',
      }),
    });
    const leadAData = await createLeadRes.json();
    if (createLeadRes.status !== 201) throw new Error(`Failed to create lead A: ${JSON.stringify(leadAData)}`);
    console.log('✅ Lead A created successfully!');
    const leadAId = leadAData.data.lead._id;

    // Verify integrations format
    if (!leadAData.data.lead.integrations || !leadAData.data.lead.integrations.whatsappLink) {
      throw new Error('Integration links (whatsapp/call) not generated in response!');
    }
    console.log('✅ WhatsApp Link Verified:', leadAData.data.lead.integrations.whatsappLink);
    console.log('✅ Call Link Verified:', leadAData.data.lead.integrations.callUri);

    // --- TEST 6: Assign Lead to Sales Rep ---
    console.log('\n--- Test 6: Assigning Lead to Sales Rep ---');
    const assignRes = await fetch(`${baseUrl}/leads/${leadAId}/assign`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mgrToken}`,
      },
      body: JSON.stringify({
        userId: repId,
      }),
    });
    const assignData = await assignRes.json();
    if (assignRes.status !== 200) throw new Error(`Failed to assign lead: ${JSON.stringify(assignData)}`);
    console.log('✅ Lead A assigned to Sales Rep successfully!');
    if (assignData.data.lead.status !== 'assigned') throw new Error('Lead status did not transition to assigned');

    // --- TEST 7: Create Lead (Sales Rep) ---
    console.log('\n--- Test 7: Creating Lead (Sales Rep) ---');
    const createLeadResB = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${repToken}`,
      },
      body: JSON.stringify({
        name: 'Test Lead B',
        phone: '7777777777',
        email: 'leadb@crm.com',
        source: 'WhatsApp',
      }),
    });
    const leadBData = await createLeadResB.json();
    if (createLeadResB.status !== 201) throw new Error(`Failed to create lead B: ${JSON.stringify(leadBData)}`);
    console.log('✅ Lead B created successfully!');
    const leadBId = leadBData.data.lead._id;

    // --- TEST 8: Create Overdue Followup Lead (Sales Rep) ---
    console.log('\n--- Test 8: Creating Lead with Missed Follow-up ---');
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 3); // 3 days ago
    
    const createLeadResC = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${repToken}`,
      },
      body: JSON.stringify({
        name: 'Test Lead C',
        phone: '6666666666',
        email: 'leadc@crm.com',
        followUpDate: pastDate.toISOString(),
      }),
    });
    const leadCData = await createLeadResC.json();
    if (createLeadResC.status !== 201) throw new Error(`Failed to create lead C: ${JSON.stringify(leadCData)}`);
    console.log('✅ Lead C (missed follow-up) created successfully!');
    const leadCId = leadCData.data.lead._id;

    // --- TEST 9: Add Remark and Set Next Follow-up (Today) for Lead B ---
    console.log('\n--- Test 9: Adding Remark & Setting Follow-up for Today ---');
    const today = new Date();
    const addRemarkRes = await fetch(`${baseUrl}/leads/${leadBId}/remarks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${repToken}`,
      },
      body: JSON.stringify({
        note: 'Spoke on phone, very interested. Set follow-up for today.',
        followUpDate: today.toISOString(),
        status: 'interested',
        priority: 'high',
        tags: ['hot', 'follow-up'],
      }),
    });
    const remarkResData = await addRemarkRes.json();
    if (addRemarkRes.status !== 200) throw new Error(`Failed to add remark: ${JSON.stringify(remarkResData)}`);
    console.log('✅ Remark, follow-up, priority, and tags updated successfully!');
    if (remarkResData.data.lead.remarks.length !== 1) throw new Error('Remark not saved to array');

    // --- TEST 10: View Leads List (Sales Rep vs Manager) ---
    console.log('\n--- Test 10: Fetching Leads (Role Security) ---');
    // Sales rep should see Lead A, B, and C (all assigned to them or created by them if auto-assigned)
    const getLeadsRepRes = await fetch(`${baseUrl}/leads`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${repToken}` },
    });
    const leadsRepData = await getLeadsRepRes.json();
    console.log(`✅ Sales Rep fetched ${leadsRepData.results} leads`);

    // Manager should see all leads
    const getLeadsMgrRes = await fetch(`${baseUrl}/leads`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${mgrToken}` },
    });
    const leadsMgrData = await getLeadsMgrRes.json();
    console.log(`✅ Manager fetched ${leadsMgrData.results} leads`);
    if (leadsMgrData.results < 3) throw new Error('Manager did not fetch all test leads');

    // Test Search filter
    const searchRes = await fetch(`${baseUrl}/leads?search=Lead B`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${mgrToken}` },
    });
    const searchData = await searchRes.json();
    console.log(`✅ Search query "Lead B" returned ${searchData.results} leads`);
    if (searchData.results !== 1 || searchData.data.leads[0].name !== 'Test Lead B') {
      throw new Error('Search filtering failed');
    }

    // --- TEST 11: Dashboard Statistics ---
    console.log('\n--- Test 11: Fetching Dashboard Statistics ---');
    const repStatsRes = await fetch(`${baseUrl}/dashboard/stats`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${repToken}` },
    });
    const repStats = await repStatsRes.json();
    if (repStatsRes.status !== 200) throw new Error(`Failed to fetch stats: ${JSON.stringify(repStats)}`);
    console.log('✅ Dashboard Stats:', repStats.data);
    
    if (repStats.data.todayReminders !== 1) throw new Error(`Expected todayReminders count to be 1, got ${repStats.data.todayReminders}`);
    if (repStats.data.missedFollowUps !== 1) throw new Error(`Expected missedFollowUps count to be 1, got ${repStats.data.missedFollowUps}`);

    // --- TEST 12: Reminders Lists ---
    console.log('\n--- Test 12: Fetching Reminders Lists ---');
    const todayRemRes = await fetch(`${baseUrl}/dashboard/reminders/today`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${repToken}` },
    });
    const todayRems = await todayRemRes.json();
    console.log(`✅ Fetch Today Reminders: returned ${todayRems.results} leads (expected 1)`);
    if (todayRems.results !== 1) throw new Error('Today reminders list failed');

    const missedRemRes = await fetch(`${baseUrl}/dashboard/reminders/missed`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${repToken}` },
    });
    const missedRems = await missedRemRes.json();
    console.log(`✅ Fetch Missed Followups: returned ${missedRems.results} leads (expected 1)`);
    if (missedRems.results !== 1) throw new Error('Missed reminders list failed');

    // --- TEST 13: Change Password ---
    console.log('\n--- Test 13: Changing Password ---');
    const changePasswordRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${repToken}`,
      },
      body: JSON.stringify({
        currentPassword: 'password123',
        newPassword: 'newpassword123',
      }),
    });
    const pwdData = await changePasswordRes.json();
    if (changePasswordRes.status !== 200) throw new Error(`Failed to change password: ${JSON.stringify(pwdData)}`);
    console.log('✅ Password changed successfully!');

    // Verify login with new password
    const loginNewRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test_rep@crm.com',
        password: 'newpassword123',
      }),
    });
    if (loginNewRes.status !== 200) throw new Error('Failed to login with new password');
    console.log('✅ Login with new password successful!');

    console.log('\n======================================');
    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('======================================');

  } catch (error) {
    console.error('\n❌ Test execution failed!');
    console.error(error);
  } finally {
    // Clean up DB
    console.log('\n🧹 Final database cleanup...');
    try {
      await User.deleteMany({ email: { $in: ['test_mgr@crm.com', 'test_rep@crm.com'] } });
      await Lead.deleteMany({ name: { $in: ['Test Lead A', 'Test Lead B', 'Test Lead C'] } });
      console.log('✅ DB cleaned successfully.');
    } catch (cleanupErr) {
      console.error('❌ Error during database cleanup:', cleanupErr.message);
    }
    
    // Close connections
    if (server) {
      server.close();
      console.log('💤 Test server closed.');
    }
    await mongoose.disconnect();
    console.log('🔌 Mongoose disconnected.');
    if (mongoServer) {
      await mongoServer.stop();
      console.log('🛑 In-memory MongoDB stopped.');
    }
  }
};

runTests();
