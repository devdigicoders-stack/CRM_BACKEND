const runAdminFlowTest = async () => {
  const baseUrl = 'http://localhost:5001/api/v1';

  try {
    console.log('1. Logging in as Super Admin...');
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'superadmin@crm.com',
        password: 'admin12345'
      })
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) throw new Error(`Super Admin Login failed: ${JSON.stringify(loginData)}`);
    const adminToken = loginData.token;
    console.log('✅ Super Admin Logged in.');

    // Helper to generate a random email to avoid duplicate errors
    const randomEmail = (prefix) => `${prefix}_${Math.floor(Math.random() * 100000)}@test.com`;
    const callingEmail = randomEmail('ravi_calling');
    const salesEmail = randomEmail('amit_sales');

    console.log(`\n2. Creating a new Calling Team agent (${callingEmail})...`);
    const createCallingRes = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Ravi Calling',
        email: callingEmail,
        password: 'callingpassword123',
        role: 'calling',
        phone: '9988776611'
      })
    });
    const callingUserData = await createCallingRes.json();
    if (!createCallingRes.ok) throw new Error(`Failed to create calling agent: ${JSON.stringify(callingUserData)}`);
    const callingUserId = callingUserData.data.user._id;
    console.log('✅ Calling Team Agent created successfully.');

    console.log(`\n3. Creating a new Sales Team agent (${salesEmail})...`);
    const createSalesRes = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Amit Sales',
        email: salesEmail,
        password: 'salespassword123',
        role: 'sales',
        phone: '9988776622'
      })
    });
    const salesUserData = await createSalesRes.json();
    if (!createSalesRes.ok) throw new Error(`Failed to create sales agent: ${JSON.stringify(salesUserData)}`);
    const salesUserId = salesUserData.data.user._id;
    console.log('✅ Sales Team Agent created successfully.');

    console.log('\n4. Creating Leads and assigning them...');
    // Create Lead 1 for Calling Team
    const lead1Res = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Test Lead Calling',
        phone: '9876540001',
        email: 'lead1@test.com',
        source: 'Direct',
        priority: 'high',
        assignedTo: callingUserId
      })
    });
    const lead1Data = await lead1Res.json();
    if (!lead1Res.ok) throw new Error(`Failed to create Lead 1: ${JSON.stringify(lead1Data)}`);
    const lead1Id = lead1Data.data.lead._id;
    console.log('✅ Lead 1 created & assigned to Calling Agent.');

    // Create Lead 2 for Sales Team
    const lead2Res = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Test Lead Sales',
        phone: '9876540002',
        email: 'lead2@test.com',
        source: 'Direct',
        priority: 'medium',
        assignedTo: salesUserId
      })
    });
    const lead2Data = await lead2Res.json();
    if (!lead2Res.ok) throw new Error(`Failed to create Lead 2: ${JSON.stringify(lead2Data)}`);
    const lead2Id = lead2Data.data.lead._id;
    console.log('✅ Lead 2 created & assigned to Sales Agent.');

    console.log('\n5. Logging in as the Calling Agent...');
    const callingLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: callingEmail,
        password: 'callingpassword123'
      })
    });
    const callingLoginData = await callingLoginRes.json();
    if (!callingLoginRes.ok) throw new Error(`Calling Agent Login failed: ${JSON.stringify(callingLoginData)}`);
    const callingToken = callingLoginData.token;
    console.log('✅ Calling Agent Logged in.');

    console.log('\n6. Checking Data Access Isolation (Security Validation)...');
    // Fetch Calling Agent's leads
    const getLeadsRes = await fetch(`${baseUrl}/leads`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${callingToken}` }
    });
    const leadsData = await getLeadsRes.json();
    const visibleLeadIds = leadsData.data.leads.map(l => l._id);
    
    console.log(`- Calling Agent sees leads: ${JSON.stringify(visibleLeadIds)}`);
    if (visibleLeadIds.includes(lead2Id)) {
      throw new Error('❌ SECURITY FAILURE: Calling Agent can see Sales Agent\'s lead in getLeads query!');
    }
    console.log('✅ GET /leads separation verified (Sales lead hidden).');

    // Fetch Sales Lead directly by ID (should be forbidden 403)
    const getSalesLeadRes = await fetch(`${baseUrl}/leads/${lead2Id}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${callingToken}` }
    });
    if (getSalesLeadRes.status === 403) {
      console.log('✅ GET /leads/:id verification successful: Returned 403 Forbidden.');
    } else {
      throw new Error(`❌ SECURITY FAILURE: Calling Agent could access Sales Lead by ID! Status: ${getSalesLeadRes.status}`);
    }

    console.log('\n7. Adding remark to Lead 1 as Calling Agent (Simulating a Call)...');
    const remarkRes = await fetch(`${baseUrl}/leads/${lead1Id}/remarks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${callingToken}`
      },
      body: JSON.stringify({
        note: 'Attempted call, customer interested. Follow up scheduled.',
        status: 'interested'
      })
    });
    const remarkData = await remarkRes.json();
    if (!remarkRes.ok) throw new Error(`Failed to add remark: ${JSON.stringify(remarkData)}`);
    console.log('✅ Remark/Call added successfully.');

    console.log('\n8. Checking Admin Dashboard insights (Lead Flow & Performance)...');
    const statsRes = await fetch(`${baseUrl}/dashboard/stats`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const statsData = await statsRes.json();
    console.log('✅ Dashboard Stats fetched. Lead Flow metrics:', statsData.data.leadFlow);
    if (statsData.data.leadFlow.callingTeam < 1 || statsData.data.leadFlow.salesPanel < 1) {
      throw new Error('❌ Dashboard Lead Flow counts are incorrect!');
    }

    const perfRes = await fetch(`${baseUrl}/dashboard/performance`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const perfData = await perfRes.json();
    console.log('✅ Dashboard Performance analytics fetched.');
    
    // Find our calling user call activity
    const callAct = perfData.data.callActivity.find(act => act._id === callingUserId);
    console.log('- Calling user call activity details:', callAct);
    if (!callAct || callAct.callsCount !== 1) {
      throw new Error(`❌ Call Activity tracking is incorrect! Expected 1 call for user, got: ${JSON.stringify(callAct)}`);
    }
    console.log('✅ Employee Call Activity and performance tracking verified.');

    console.log('\n🌟 ALL INTEGRATION AND SECURITY TESTS PASSED SUCCESSFULLY! 🌟');
  } catch (error) {
    console.error('❌ Integration Test Failed:', error.message);
  }
};

runAdminFlowTest();
