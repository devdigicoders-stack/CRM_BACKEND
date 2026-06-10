const runSalesFlowTest = async () => {
  const baseUrl = 'http://localhost:5001/api/v1';

  try {
    console.log('1. Logging in as Super Admin...');
    const adminLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'superadmin@crm.com',
        password: 'admin12345'
      })
    });
    const adminLoginData = await adminLoginRes.json();
    if (!adminLoginRes.ok) throw new Error(`Admin Login failed: ${JSON.stringify(adminLoginData)}`);
    const adminToken = adminLoginData.token;
    console.log('✅ Admin Logged in.');

    const randomNum = Math.floor(Math.random() * 100000);
    const salesEmail = `amit_sales_${randomNum}@test.com`;
    const otherSalesEmail = `other_sales_${randomNum}@test.com`;
    const acctEmail = `suresh_acct_${randomNum}@test.com`;

    console.log(`\n2. Creating Sales Agent (${salesEmail})...`);
    const createSalesRes = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Amit Sales Rep',
        email: salesEmail,
        password: 'salespassword123',
        role: 'sales',
        phone: '9988776655'
      })
    });
    const salesData = await createSalesRes.json();
    if (!createSalesRes.ok) throw new Error(`Failed to create sales agent: ${JSON.stringify(salesData)}`);
    const salesUserId = salesData.data.user._id;
    console.log('✅ Sales Agent created.');

    console.log(`\n3. Creating Other Sales Agent (${otherSalesEmail})...`);
    const createOtherSalesRes = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Other Sales Rep',
        email: otherSalesEmail,
        password: 'salespassword123',
        role: 'sales',
        phone: '9988776677'
      })
    });
    const otherSalesData = await createOtherSalesRes.json();
    console.log('✅ Other Sales Agent created.');

    console.log(`\n4. Creating Accountant (${acctEmail})...`);
    const createAcctRes = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Suresh Accountant',
        email: acctEmail,
        password: 'accountantpassword123',
        role: 'accountant',
        phone: '9988776666'
      })
    });
    const acctData = await createAcctRes.json();
    console.log('✅ Accountant created.');

    console.log('\n5. Creating Lead assigned to Sales Agent...');
    const createLeadRes = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Jane Prospect Deal',
        phone: '9988998822',
        email: 'jane@example.com',
        source: 'Google Ads',
        priority: 'medium',
        assignedTo: salesUserId
      })
    });
    const leadData = await createLeadRes.json();
    if (!createLeadRes.ok) throw new Error(`Failed to create lead: ${JSON.stringify(leadData)}`);
    const leadId = leadData.data.lead._id;
    console.log('✅ Lead created. ID:', leadId);

    console.log('\n6. Logging in as Sales Agent...');
    const salesLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: salesEmail,
        password: 'salespassword123'
      })
    });
    const salesLoginData = await salesLoginRes.json();
    const salesToken = salesLoginData.token;
    console.log('✅ Sales Agent Logged in.');

    console.log('\n7. Updating Lead Status to in_process (Managing Lead Progress)...');
    const updateStatusRes = await fetch(`${baseUrl}/leads/${leadId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${salesToken}`
      },
      body: JSON.stringify({ status: 'in_process' })
    });
    const statusData = await updateStatusRes.json();
    if (!updateStatusRes.ok) throw new Error(`Failed to progress lead status: ${JSON.stringify(statusData)}`);
    console.log('✅ Lead progressed to status:', statusData.data.lead.status);

    console.log('\n8. Adding Product & Deal Value Details...');
    const detailsRes = await fetch(`${baseUrl}/leads/${leadId}/sale-details`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${salesToken}`
      },
      body: JSON.stringify({
        productDetails: 'Commercial Solar Panel System - 10kW',
        dealValue: 75000
      })
    });
    const detailsData = await detailsRes.json();
    if (!detailsRes.ok) throw new Error(`Failed to update sale details: ${JSON.stringify(detailsData)}`);
    console.log('✅ Product and Deal details updated:', {
      product: detailsData.data.lead.productDetails,
      dealValue: detailsData.data.lead.dealValue
    });

    console.log('\n9. Testing Handoff Visibility (Should NOT be visible to accounts yet)...');
    const acctLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: acctEmail, password: 'accountantpassword123' })
    });
    const acctToken = (await acctLoginRes.json()).token;
    const closedLeadsResBefore = await fetch(`${baseUrl}/accounts/leads`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${acctToken}` }
    });
    const closedLeadsDataBefore = await closedLeadsResBefore.json();
    const isVisibleBefore = closedLeadsDataBefore.data.leads.some(l => l._id === leadId);
    console.log(`- Lead is visible to accountant before handoff: ${isVisibleBefore}`);
    if (isVisibleBefore) throw new Error('❌ Integration failure: Lead is visible to accountant before handoff transfer!');

    console.log('\n10. Transferring Lead to Accounts Team...');
    const transferRes = await fetch(`${baseUrl}/leads/${leadId}/transfer-to-accounts`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${salesToken}` }
    });
    const transferData = await transferRes.json();
    if (!transferRes.ok) throw new Error(`Transfer failed: ${JSON.stringify(transferData)}`);
    console.log('✅ Lead transferred to accounts successfully:', {
      transferredToAccounts: transferData.data.lead.transferredToAccounts,
      status: transferData.data.lead.status
    });

    console.log('\n11. Verifying Handoff Visibility (Should be visible to accounts now)...');
    const closedLeadsResAfter = await fetch(`${baseUrl}/accounts/leads`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${acctToken}` }
    });
    const closedLeadsDataAfter = await closedLeadsResAfter.json();
    const isVisibleAfter = closedLeadsDataAfter.data.leads.some(l => l._id === leadId);
    console.log(`- Lead is visible to accountant after handoff: ${isVisibleAfter}`);
    if (!isVisibleAfter) throw new Error('❌ Integration failure: Lead is NOT visible to accountant after handoff transfer!');

    console.log('\n12. Updating Delivery Status & Timeline...');
    const deliveryRes = await fetch(`${baseUrl}/leads/${leadId}/delivery`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${salesToken}`
      },
      body: JSON.stringify({
        deliveryStatus: 'in_progress',
        expectedDeliveryDate: '2026-07-15T00:00:00.000Z'
      })
    });
    const deliveryData = await deliveryRes.json();
    if (!deliveryRes.ok) throw new Error(`Delivery update failed: ${JSON.stringify(deliveryData)}`);
    console.log('✅ Delivery status updated:', {
      deliveryStatus: deliveryData.data.lead.deliveryStatus,
      expectedDeliveryDate: deliveryData.data.lead.expectedDeliveryDate
    });

    console.log('\n13. Performing Security Authorization Checks (Zero Data Leakage)...');
    // Log in as other sales rep
    const otherSalesLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: otherSalesEmail, password: 'salespassword123' })
    });
    const otherSalesToken = (await otherSalesLoginRes.json()).token;

    // Try to update lead details as other sales rep (should be forbidden 403)
    const unauthorizedRes = await fetch(`${baseUrl}/leads/${leadId}/sale-details`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${otherSalesToken}`
      },
      body: JSON.stringify({ productDetails: 'Hacked Solar', dealValue: 999999 })
    });
    console.log(`- Non-assigned Sales Rep update status code: ${unauthorizedRes.status}`);
    if (unauthorizedRes.status === 403) {
      console.log('✅ Cross-user data modification prevented (Returned 403 Forbidden).');
    } else {
      throw new Error(`❌ SECURITY FAILURE: Non-assigned Sales Rep could edit lead details! Status: ${unauthorizedRes.status}`);
    }

    console.log('\n🌟 ALL SALES PANEL BACKEND FLOW TESTS PASSED SUCCESSFULLY! 🌟');
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  }
};

runSalesFlowTest();
