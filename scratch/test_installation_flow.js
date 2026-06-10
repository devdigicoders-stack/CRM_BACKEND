import fs from 'fs';
import path from 'path';

const baseUrl = 'http://localhost:5001/api/v1';

async function runTests() {
  try {
    console.log('--- STARTING INSTALLATION PANEL FLOW TESTS ---');

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

    // 2. Create Accountant user
    const rand = Math.round(Math.random() * 100000);
    const accountantEmail = `accountant_${rand}@test.com`;
    console.log(`\n[2] Creating Accountant user (${accountantEmail})...`);
    const createAccountantRes = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `Ajeet Accountant ${rand}`,
        email: accountantEmail,
        password: 'accountant123',
        role: 'accountant',
        phone: '9876543210'
      })
    });
    const createAccountant = await createAccountantRes.json();
    if (!createAccountantRes.ok) throw new Error(`Create Accountant failed: ${JSON.stringify(createAccountant)}`);
    console.log('✅ Accountant user created successfully.');

    // 3. Create two Installer users
    const installer1Email = `installer1_${rand}@test.com`;
    console.log(`\n[3a] Creating Installer 1 user (${installer1Email})...`);
    const createInstaller1Res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `Installer One ${rand}`,
        email: installer1Email,
        password: 'installer123',
        role: 'installation',
        phone: '9876543211'
      })
    });
    const createInstaller1 = await createInstaller1Res.json();
    if (!createInstaller1Res.ok) throw new Error(`Create Installer 1 failed: ${JSON.stringify(createInstaller1)}`);
    const installer1Id = createInstaller1.data.user._id;
    console.log(`✅ Installer 1 created with ID: ${installer1Id}`);

    const installer2Email = `installer2_${rand}@test.com`;
    console.log(`[3b] Creating Installer 2 user (${installer2Email})...`);
    const createInstaller2Res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `Installer Two ${rand}`,
        email: installer2Email,
        password: 'installer123',
        role: 'installation',
        phone: '9876543212'
      })
    });
    const createInstaller2 = await createInstaller2Res.json();
    if (!createInstaller2Res.ok) throw new Error(`Create Installer 2 failed: ${JSON.stringify(createInstaller2)}`);
    const installer2Id = createInstaller2.data.user._id;
    console.log(`✅ Installer 2 created with ID: ${installer2Id}`);

    // 4. Log in as Accountant & Installer 1 & Installer 2
    console.log('\n[4a] Logging in as Accountant...');
    const accLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: accountantEmail, password: 'accountant123' })
    });
    const accLogin = await accLoginRes.json();
    const accToken = accLogin.token;
    console.log('✅ Accountant logged in.');

    console.log('[4b] Logging in as Installer 1...');
    const inst1LoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: installer1Email, password: 'installer123' })
    });
    const inst1Login = await inst1LoginRes.json();
    const inst1Token = inst1Login.token;
    console.log('✅ Installer 1 logged in.');

    console.log('[4c] Logging in as Installer 2...');
    const inst2LoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: installer2Email, password: 'installer123' })
    });
    const inst2Login = await inst2LoginRes.json();
    const inst2Token = inst2Login.token;
    console.log('✅ Installer 2 logged in.');

    // 5. Create a Lead as Super Admin
    console.log('\n[5] Creating a test lead...');
    const createLeadRes = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `Lead ${rand}`,
        phone: '9988776655',
        email: `lead_${rand}@example.com`,
        source: 'Direct',
        priority: 'high'
      })
    });
    const createLead = await createLeadRes.json();
    if (!createLeadRes.ok) throw new Error(`Create lead failed: ${JSON.stringify(createLead)}`);
    const leadId = createLead.data.lead._id;
    console.log(`✅ Lead created with ID: ${leadId}`);

    // 6. Transfer lead to accounts team
    console.log('\n[6] Transferring lead to accounts team...');
    const transferAccRes = await fetch(`${baseUrl}/leads/${leadId}/transfer-to-accounts`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (!transferAccRes.ok) throw new Error(`Transfer to accounts failed: ${await transferAccRes.text()}`);
    console.log('✅ Lead status updated to converted & transferred to accounts.');

    // 7. Accountant verifies sale
    console.log('\n[7] Accountant verifying sale...');
    const verifySaleRes = await fetch(`${baseUrl}/accounts/leads/${leadId}/verify`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accToken}`
      },
      body: JSON.stringify({
        verificationStatus: 'verified',
        remarks: 'Test verification by Ajeet Accountant'
      })
    });
    if (!verifySaleRes.ok) throw new Error(`Verification failed: ${await verifySaleRes.text()}`);
    console.log('✅ Sale verified by Accountant.');

    // 8. Accountant transfers to installation
    console.log('\n[8] Accountant transferring lead to Installation...');
    const transferInstRes = await fetch(`${baseUrl}/accounts/leads/${leadId}/transfer`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${accToken}` }
    });
    if (!transferInstRes.ok) throw new Error(`Transfer to installation failed: ${await transferInstRes.text()}`);
    console.log('✅ Lead transferred to Installation Team.');

    // 9. Accountant/Admin assigns Installer 1 to the lead
    console.log('\n[9] Assigning Installer 1 to the lead...');
    const assignRepRes = await fetch(`${baseUrl}/installation/leads/${leadId}/assign-rep`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accToken}`
      },
      body: JSON.stringify({
        installerId: installer1Id
      })
    });
    const assignRep = await assignRepRes.json();
    if (!assignRepRes.ok) throw new Error(`Assignment failed: ${JSON.stringify(assignRep)}`);
    console.log(`✅ Lead successfully assigned to Installer 1.`);

    // 10. Test Installer 1 Dashboard
    console.log('\n[10] Checking Installer 1 dashboard...');
    const inst1DashboardRes = await fetch(`${baseUrl}/installation/dashboard`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${inst1Token}` }
    });
    const inst1Dashboard = await inst1DashboardRes.json();
    console.log('Installer 1 Dashboard data:', inst1Dashboard.data);
    if (inst1Dashboard.data.totalAssigned !== 1) {
      throw new Error(`Expected 1 totalAssigned lead, got ${inst1Dashboard.data.totalAssigned}`);
    }
    console.log('✅ Dashboard shows correct assigned count for Installer 1.');

    // 11. Test Installer 2 (Data Leakage check - should see 0)
    console.log('\n[11] Checking Installer 2 dashboard (for zero data leakage)...');
    const inst2DashboardRes = await fetch(`${baseUrl}/installation/dashboard`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${inst2Token}` }
    });
    const inst2Dashboard = await inst2DashboardRes.json();
    console.log('Installer 2 Dashboard data:', inst2Dashboard.data);
    if (inst2Dashboard.data.totalAssigned !== 0) {
      throw new Error(`Expected 0 totalAssigned lead for Installer 2, got ${inst2Dashboard.data.totalAssigned}`);
    }
    console.log('✅ Installer 2 has 0 installations assigned (no data leakage).');

    // 12. Test assigned leads list
    console.log('\n[12a] Fetching assigned leads for Installer 1...');
    const inst1LeadsRes = await fetch(`${baseUrl}/installation/leads`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${inst1Token}` }
    });
    const inst1Leads = await inst1LeadsRes.json();
    console.log(`Installer 1 assigned leads count: ${inst1Leads.data.leads.length}`);
    if (inst1Leads.data.leads.length !== 1 || inst1Leads.data.leads[0]._id !== leadId) {
      throw new Error('Assigned leads list does not match expected lead');
    }
    console.log('Integration links returned:', inst1Leads.data.leads[0].integrations);
    if (!inst1Leads.data.leads[0].integrations || !inst1Leads.data.leads[0].integrations.whatsappLink) {
      throw new Error('Integrations metadata missing from response');
    }
    console.log('✅ Installer 1 leads list correct with integration links.');

    console.log('\n[12b] Fetching assigned leads for Installer 2...');
    const inst2LeadsRes = await fetch(`${baseUrl}/installation/leads`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${inst2Token}` }
    });
    const inst2Leads = await inst2LeadsRes.json();
    console.log(`Installer 2 assigned leads count: ${inst2Leads.data.leads.length}`);
    if (inst2Leads.data.leads.length !== 0) {
      throw new Error(`Installer 2 should have 0 leads, got ${inst2Leads.data.leads.length}`);
    }
    console.log('✅ Installer 2 leads list is empty (no data leakage).');

    // 13. Installer 2 tries to update Installer 1's lead (should return 403 Forbidden)
    console.log('\n[13] Installer 2 attempting to update Installer 1\'s lead status (Authorization Isolation)...');
    const unauthorizedUpdateRes = await fetch(`${baseUrl}/installation/leads/${leadId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${inst2Token}`
      },
      body: JSON.stringify({
        status: 'in_progress',
        progressRemarks: 'Trying to sneakily update someone else\'s lead.'
      })
    });
    const unauthorizedUpdate = await unauthorizedUpdateRes.json();
    console.log(`Status code: ${unauthorizedUpdateRes.status}, Body:`, unauthorizedUpdate);
    if (unauthorizedUpdateRes.status !== 403) {
      throw new Error(`Expected status 403, got ${unauthorizedUpdateRes.status}`);
    }
    console.log('✅ Properly blocked unauthorized update attempt.');

    // 14. Installer 1 updates status to in_progress
    console.log('\n[14] Installer 1 updating lead status to in_progress...');
    const statusUpdateRes = await fetch(`${baseUrl}/installation/leads/${leadId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${inst1Token}`
      },
      body: JSON.stringify({
        status: 'in_progress',
        progressRemarks: 'Panels received, beginning structural mounting.'
      })
    });
    const statusUpdate = await statusUpdateRes.json();
    if (!statusUpdateRes.ok) throw new Error(`Status update failed: ${JSON.stringify(statusUpdate)}`);
    console.log('Updated lead details status:', statusUpdate.data.lead.installationStatus);
    if (statusUpdate.data.lead.installationStatus !== 'in_progress') {
      throw new Error(`Expected installationStatus to be 'in_progress', got ${statusUpdate.data.lead.installationStatus}`);
    }
    console.log('✅ Installer 1 status updated to in_progress.');

    // 15. Installer 1 reports delay / issue
    console.log('\n[15] Installer 1 reporting an issue/delay...');
    const reportIssueRes = await fetch(`${baseUrl}/installation/leads/${leadId}/issue`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${inst1Token}`
      },
      body: JSON.stringify({
        issueRemarks: 'Faced structural alignment challenge. Working on solution.'
      })
    });
    const reportIssue = await reportIssueRes.json();
    if (!reportIssueRes.ok) throw new Error(`Report issue failed: ${JSON.stringify(reportIssue)}`);
    console.log('Lead reported issue flag:', reportIssue.data.lead.installationIssueReported);
    console.log('Lead issue remarks:', reportIssue.data.lead.installationIssueRemarks);
    if (!reportIssue.data.lead.installationIssueReported) {
      throw new Error('Expected installationIssueReported to be true');
    }
    console.log('✅ Issue reported successfully.');

    // 16. Installer 1 uploads installation proof (using multipart/form-data)
    console.log('\n[16] Installer 1 uploading installation proof...');
    
    // Create a dummy file in scratch directory
    const scratchDir = path.join(process.cwd(), 'scratch');
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }
    const tempFilePath = path.join(scratchDir, 'temp_proof.png');
    fs.writeFileSync(tempFilePath, 'dummy image content for testing');

    const form = new FormData();
    const fileContent = fs.readFileSync(tempFilePath);
    const blob = new Blob([fileContent], { type: 'image/png' });
    form.append('proof', blob, 'temp_proof.png');

    const uploadRes = await fetch(`${baseUrl}/installation/leads/${leadId}/proof`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${inst1Token}`
      },
      body: form
    });
    
    // Cleanup temp file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(`Proof upload failed: ${JSON.stringify(uploadData)}`);
    console.log('Proof URL in response:', uploadData.data.lead.installationProofUrl);
    if (!uploadData.data.lead.installationProofUrl) {
      throw new Error('Expected installationProofUrl to be populated');
    }
    console.log('✅ Proof uploaded successfully.');

    // 17. Installer 1 completes installation
    console.log('\n[17] Installer 1 marking installation as completed...');
    const completeRes = await fetch(`${baseUrl}/installation/leads/${leadId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${inst1Token}`
      },
      body: JSON.stringify({
        status: 'completed',
        progressRemarks: 'Everything mounted and tested. Work finished.'
      })
    });
    const completeData = await completeRes.json();
    if (!completeRes.ok) throw new Error(`Complete failed: ${JSON.stringify(completeData)}`);
    console.log('Final installation status:', completeData.data.lead.installationStatus);
    if (completeData.data.lead.installationStatus !== 'completed') {
      throw new Error(`Expected installationStatus to be 'completed'`);
    }
    console.log('✅ Installation successfully completed!');

    console.log('\n=============================================');
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('=============================================');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    process.exit(1);
  }
}

runTests();
