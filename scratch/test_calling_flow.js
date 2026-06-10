import fs from 'fs';
import path from 'path';

const baseUrl = 'http://localhost:5001/api/v1';

async function runTests() {
  try {
    console.log('--- STARTING TELECALLER/CALLING PANEL FLOW TESTS ---');

    // 1. Login as Super Admin
    console.log('\n[1] Logging in as Super Admin...');
    const superAdminLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'superadmin@crm.com',
        password: 'admin12345'
      })
    });
    const superAdminLogin = await superAdminLoginRes.json();
    if (!superAdminLoginRes.ok) throw new Error(`Super admin login failed: ${JSON.stringify(superAdminLogin)}`);
    const adminToken = superAdminLogin.token;
    console.log('✅ Super Admin logged in successfully.');

    // 2. Create Calling Rep & Sales Rep users
    const rand = Math.round(Math.random() * 100000);
    const callingEmail = `calling_${rand}@test.com`;
    console.log(`\n[2a] Creating Calling Representative (${callingEmail})...`);
    const createCallingRes = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `Calling Agent ${rand}`,
        email: callingEmail,
        password: 'callingpassword123',
        role: 'calling',
        phone: '9988775500'
      })
    });
    const createCalling = await createCallingRes.json();
    if (!createCallingRes.ok) throw new Error(`Create Calling agent failed: ${JSON.stringify(createCalling)}`);
    const callingId = createCalling.data.user._id;
    console.log(`✅ Calling agent created with ID: ${callingId}`);

    const salesEmail = `sales_${rand}@test.com`;
    console.log(`[2b] Creating Sales Representative (${salesEmail})...`);
    const createSalesRes = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `Sales Rep ${rand}`,
        email: salesEmail,
        password: 'salespassword123',
        role: 'sales',
        phone: '9988775511'
      })
    });
    const createSales = await createSalesRes.json();
    if (!createSalesRes.ok) throw new Error(`Create Sales rep failed: ${JSON.stringify(createSales)}`);
    const salesId = createSales.data.user._id;
    console.log(`✅ Sales rep created with ID: ${salesId}`);

    // 3. Log in as Calling Rep & Sales Rep
    console.log('\n[3a] Logging in as Calling Representative...');
    const callLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: callingEmail, password: 'callingpassword123' })
    });
    const callLogin = await callLoginRes.json();
    const callToken = callLogin.token;
    console.log('✅ Calling Representative logged in.');

    console.log('[3b] Logging in as Sales Representative...');
    const salesLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: salesEmail, password: 'salespassword123' })
    });
    const salesLogin = await salesLoginRes.json();
    const salesToken = salesLogin.token;
    console.log('✅ Sales Representative logged in.');

    // 4. Create Lead as Calling Rep (should default assignedTo to themselves)
    console.log('\n[4] Creating a lead as Calling Representative (Add new leads)...');
    const createLeadRes = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${callToken}`
      },
      body: JSON.stringify({
        name: `Lead ${rand}`,
        phone: '9988112233',
        email: `lead_${rand}@example.com`,
        source: 'Google Ads',
        priority: 'medium',
        remark: 'Initial inquiry about premium solar panels'
      })
    });
    const createLead = await createLeadRes.json();
    if (!createLeadRes.ok) throw new Error(`Create lead failed: ${JSON.stringify(createLead)}`);
    const leadId = createLead.data.lead._id;
    console.log(`✅ Lead created with ID: ${leadId}. Assigned to: ${createLead.data.lead.assignedTo}`);
    if (createLead.data.lead.assignedTo !== callingId) {
      throw new Error('Expected lead to be self-assigned to the calling rep by default');
    }

    // 5. View assigned leads list as Calling Rep (should contain the lead & check links)
    console.log('\n[5] Viewing assigned leads list (View assigned leads & Direct WhatsApp/Call integration)...');
    const leadsRes = await fetch(`${baseUrl}/leads`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${callToken}` }
    });
    const leadsList = await leadsRes.json();
    if (leadsList.data.leads.length !== 1 || leadsList.data.leads[0]._id !== leadId) {
      throw new Error(`Expected exactly 1 lead with ID ${leadId}, got ${leadsList.data.leads.length}`);
    }
    const leadObj = leadsList.data.leads[0];
    console.log('Direct Call and WhatsApp integrations returned:', leadObj.integrations);
    if (!leadObj.integrations || !leadObj.integrations.whatsappLink || !leadObj.integrations.callUri) {
      throw new Error('Integrations details missing or invalid');
    }
    console.log('✅ Leads list and communication integration links verified.');

    // 6. Update lead details after communication
    console.log('\n[6] Updating lead details after communication (Update lead details)...');
    const updateRes = await fetch(`${baseUrl}/leads/${leadId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${callToken}`
      },
      body: JSON.stringify({
        name: `Updated Lead Name ${rand}`,
        phone: '9988112244'
      })
    });
    const updateData = await updateRes.json();
    if (!updateRes.ok) throw new Error(`Update lead failed: ${JSON.stringify(updateData)}`);
    console.log('Updated Name:', updateData.data.lead.name, 'Updated Phone:', updateData.data.lead.phone);
    if (updateData.data.lead.name !== `Updated Lead Name ${rand}`) {
      throw new Error('Update details mismatch');
    }
    console.log('✅ Lead details updated successfully.');

    // 7. Add call notes / remarks & Set next follow-up date, tags, priority
    console.log('\n[7] Adding call notes, setting next follow-up, priority and tags (Add remarks & Set follow-up)...');
    const tomorrowStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const remarkRes = await fetch(`${baseUrl}/leads/${leadId}/remarks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${callToken}`
      },
      body: JSON.stringify({
        note: 'Customer wants a pricing quote. Requested call tomorrow at 10 AM.',
        followUpDate: tomorrowStr,
        tags: ['Interested', 'FollowUpRequired'],
        priority: 'high',
        status: 'interested'
      })
    });
    const remarkData = await remarkRes.json();
    if (!remarkRes.ok) throw new Error(`Add remark failed: ${JSON.stringify(remarkData)}`);
    const finalLead = remarkData.data.lead;
    console.log('Status updated to:', finalLead.status);
    console.log('Priority updated to:', finalLead.priority);
    console.log('Tags updated to:', finalLead.tags);
    console.log('Follow up date set:', finalLead.followUpDate);
    console.log('Remarks list length:', finalLead.remarks.length);

    if (finalLead.status !== 'interested' || finalLead.priority !== 'high' || finalLead.remarks.length !== 2) {
      throw new Error('Remark details or secondary updates mismatch');
    }
    console.log('✅ Call notes added and follow-up / tags / priority set.');

    // 8. Test Today's Reminders & Missed Follow-ups dashboard endpoints
    console.log('\n[8a] Checking Today\'s Reminders list...');
    const todayRes = await fetch(`${baseUrl}/dashboard/reminders/today`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${callToken}` }
    });
    const todayData = await todayRes.json();
    console.log('Today\'s reminders count (should be 0 because follow-up is tomorrow):', todayData.results);
    
    console.log('[8b] Checking Dashboard stats...');
    const statsRes = await fetch(`${baseUrl}/dashboard/stats`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${callToken}` }
    });
    const statsData = await statsRes.json();
    console.log('Calling Rep Dashboard stats:', statsData.data);
    if (statsData.data.totalLeads !== 1) {
      throw new Error(`Expected 1 total lead, got ${statsData.data.totalLeads}`);
    }
    console.log('✅ Dashboard stats and reminders check out.');

    // 9. Assign Interested Lead to Sales Panel (PUT /leads/:id/assign)
    console.log('\n[9] Assigning Interested Lead to the Sales Rep...');
    const assignRes = await fetch(`${baseUrl}/leads/${leadId}/assign`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${callToken}`
      },
      body: JSON.stringify({
        userId: salesId
      })
    });
    const assignData = await assignRes.json();
    if (!assignRes.ok) throw new Error(`Assign lead failed: ${JSON.stringify(assignData)}`);
    console.log('Assigned lead new assignee:', assignData.data.lead.assignedTo);
    if (assignData.data.lead.assignedTo !== salesId) {
      throw new Error('Reassignment to Sales Rep failed');
    }
    console.log('✅ Lead successfully assigned to Sales Rep.');

    // 10. Data Leakage Check: Calling Rep should no longer have access to view or edit this lead
    console.log('\n[10a] Verification: Checking if Calling Rep has access to the lead after assignment (Zero Data Leakage)...');
    const viewUnassignedRes = await fetch(`${baseUrl}/leads/${leadId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${callToken}` }
    });
    const viewUnassigned = await viewUnassignedRes.json();
    console.log(`Status code: ${viewUnassignedRes.status}, Message: ${viewUnassigned.message}`);
    if (viewUnassignedRes.status !== 403) {
      throw new Error('Expected Calling Rep to be blocked with 403 from viewing the lead');
    }

    console.log('[10b] Verification: Checking if Sales Rep can view the lead...');
    const salesViewRes = await fetch(`${baseUrl}/leads/${leadId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${salesToken}` }
    });
    const salesView = await salesViewRes.ok ? await salesViewRes.json() : null;
    if (!salesViewRes.ok) throw new Error(`Sales rep failed to view lead: ${JSON.stringify(salesView)}`);
    console.log('Sales Rep successfully retrieved the lead. Current Status:', salesView.data.lead.status);
    console.log('Audit remarks history length:', salesView.data.lead.remarks.length);
    console.log('Last Remark Note:', salesView.data.lead.remarks[salesView.data.lead.remarks.length - 1].note);

    console.log('\n=============================================');
    console.log('🎉 ALL TELECALLER PANEL TESTS PASSED! 🎉');
    console.log('=============================================');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    process.exit(1);
  }
}

runTests();
