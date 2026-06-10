const runAccountantFlowTest = async () => {
  const baseUrl = 'http://localhost:5001/api/v1';

  try {
    console.log('1. Logging in as Super Admin to set up Accountant and Lead...');
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
    const accountantEmail = `suresh_${randomNum}@test.com`;
    const salesEmail = `agent_${randomNum}@test.com`;

    console.log(`\n2. Creating Accountant user (${accountantEmail})...`);
    const createAcctRes = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Suresh Accountant',
        email: accountantEmail,
        password: 'accountantpassword123',
        role: 'accountant',
        phone: '9988776633'
      })
    });
    const acctData = await createAcctRes.json();
    if (!createAcctRes.ok) throw new Error(`Failed to create accountant: ${JSON.stringify(acctData)}`);
    console.log('✅ Accountant created successfully.');

    console.log(`\n3. Creating Sales Agent user (${salesEmail})...`);
    const createSalesRes = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Amit Sales Agent',
        email: salesEmail,
        password: 'salespassword123',
        role: 'sales',
        phone: '9988776644'
      })
    });
    const salesData = await createSalesRes.json();
    const salesToken = (await (await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: salesEmail, password: 'salespassword123' })
    })).json()).token;
    console.log('✅ Sales agent created and logged in.');

    console.log('\n4. Creating a Closed Won (Converted) Lead as Admin...');
    const createLeadRes = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'John Closed Deal',
        phone: '9988998811',
        email: 'john@example.com',
        source: 'Google Ads',
        priority: 'high',
        status: 'converted' // represent Closed Won
      })
    });
    const leadData = await createLeadRes.json();
    if (!createLeadRes.ok) throw new Error(`Failed to create lead: ${JSON.stringify(leadData)}`);
    const leadId = leadData.data.lead._id;
    console.log('✅ Closed Won Lead created. ID:', leadId);

    console.log('\n5. Logging in as Accountant...');
    const acctLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: accountantEmail,
        password: 'accountantpassword123'
      })
    });
    const acctLoginData = await acctLoginRes.json();
    if (!acctLoginRes.ok) throw new Error(`Accountant Login failed: ${JSON.stringify(acctLoginData)}`);
    const acctToken = acctLoginData.token;
    console.log('✅ Accountant Logged in.');

    console.log('\n6. Fetching Accountant Dashboard...');
    const dashRes = await fetch(`${baseUrl}/accounts/dashboard`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${acctToken}` }
    });
    const dashData = await dashRes.json();
    console.log('✅ Accountant Dashboard Stats:', dashData.data);
    if (dashData.data.totalClosedWon < 1) {
      throw new Error(`Expected at least 1 closed won lead, got ${dashData.data.totalClosedWon}`);
    }

    console.log('\n7. Fetching Closed Won Leads List...');
    const leadsRes = await fetch(`${baseUrl}/accounts/leads`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${acctToken}` }
    });
    const leadsData = await leadsRes.json();
    console.log(`✅ Fetched closed leads count: ${leadsData.results}`);

    console.log('\n8. Updating Payment & Transaction Details (EMI, partial)...');
    const paymentRes = await fetch(`${baseUrl}/accounts/leads/${leadId}/payment`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${acctToken}`
      },
      body: JSON.stringify({
        paymentMode: 'emi',
        paymentStatus: 'partial',
        transactionDetails: 'Ref ID: SBI_9988776655 - Downpayment received'
      })
    });
    const paymentData = await paymentRes.json();
    if (!paymentRes.ok) throw new Error(`Payment update failed: ${JSON.stringify(paymentData)}`);
    console.log('✅ Payment and transaction details updated:', {
      paymentMode: paymentData.data.lead.paymentMode,
      paymentStatus: paymentData.data.lead.paymentStatus,
      transactionDetails: paymentData.data.lead.transactionDetails
    });

    console.log('\n9. Adding Tracking ID...');
    const trackingRes = await fetch(`${baseUrl}/accounts/leads/${leadId}/tracking`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${acctToken}`
      },
      body: JSON.stringify({
        trackingId: 'TRACK_DHL_999888'
      })
    });
    const trackingData = await trackingRes.json();
    if (!trackingRes.ok) throw new Error(`Tracking update failed: ${JSON.stringify(trackingData)}`);
    console.log('✅ Tracking ID updated:', trackingData.data.lead.trackingId);

    console.log('\n10. Approving/Verifying Sale...');
    const verifyRes = await fetch(`${baseUrl}/accounts/leads/${leadId}/verify`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${acctToken}`
      },
      body: JSON.stringify({
        verificationStatus: 'verified',
        remarks: 'All documents checked, transaction verified'
      })
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(`Verification update failed: ${JSON.stringify(verifyData)}`);
    console.log('✅ Sale verificationStatus updated:', verifyData.data.lead.verificationStatus);

    console.log('\n11. Transferring Verified Lead to Installation Team...');
    const transferRes = await fetch(`${baseUrl}/accounts/leads/${leadId}/transfer`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${acctToken}` }
    });
    const transferData = await transferRes.json();
    if (!transferRes.ok) throw new Error(`Transfer failed: ${JSON.stringify(transferData)}`);
    console.log('✅ Lead transferredToInstallation status:', transferData.data.lead.transferredToInstallation);

    console.log('\n12. Performing Security Authorization Checks (Zero Data Leakage)...');
    // Attempting to access accounts stats as a sales representative
    const salesAccessRes = await fetch(`${baseUrl}/accounts/dashboard`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${salesToken}` }
    });
    console.log(`- Sales Agent access to /accounts/dashboard status code: ${salesAccessRes.status}`);
    if (salesAccessRes.status === 403) {
      console.log('✅ Unauthorized access prevented (Returned 403 Forbidden).');
    } else {
      throw new Error(`❌ SECURITY FAILURE: Sales Rep could access Accountant Panel! Status: ${salesAccessRes.status}`);
    }

    console.log('\n🌟 ALL ACCOUNTANT PANEL BACKEND FLOW TESTS PASSED SUCCESSFULLY! 🌟');
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  }
};

runAccountantFlowTest();
