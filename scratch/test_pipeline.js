import assert from 'assert';

const BASE_URL = 'http://localhost:5001/api/v1';

async function runTests() {
  console.log('🧪 Starting Restructured CRM Backend Verification Tests...');
  let superAdminToken = '';
  let adminId = '';
  let salesRepId = '';
  let leadId = '';
  
  try {
    // 1. Health Check
    console.log('\n1. Verifying Health Check...');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthData = await healthRes.json();
    assert.strictEqual(healthRes.status, 200, 'Health check failed');
    console.log('✅ Health check passed:', healthData);

    // 2. Super Admin Login (seeded automatically on startup in admins collection)
    console.log('\n2. Verifying Super Admin Login...');
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'superadmin@crm.com',
        password: 'admin12345'
      })
    });
    const loginData = await loginRes.json();
    assert.strictEqual(loginRes.status, 200, 'Super Admin login failed');
    assert.ok(loginData.token, 'Token not received');
    superAdminToken = loginData.token;
    console.log('✅ Super Admin login passed. Token retrieved.');

    // 3. Get Settings
    console.log('\n3. Verifying Get Settings...');
    const settingsGetRes = await fetch(`${BASE_URL}/settings`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    const settingsGetData = await settingsGetRes.json();
    assert.strictEqual(settingsGetRes.status, 200, 'Failed to fetch settings');
    console.log('✅ Fetch settings passed. Current tags:', settingsGetData.data.settings.leadTags);

    // 4. Update Settings
    console.log('\n4. Verifying Update Settings...');
    const settingsPutRes = await fetch(`${BASE_URL}/settings`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        leadSources: ['Direct', 'Facebook Ads', 'Google Ads', 'Instagram Ads'],
        leadTags: ['new', 'interested', 'hot', 'warm', 'cold', 'converted', 'missed']
      })
    });
    const settingsPutData = await settingsPutRes.json();
    assert.strictEqual(settingsPutRes.status, 200, 'Failed to update settings');
    assert.ok(settingsPutData.data.settings.leadSources.includes('Instagram Ads'), 'Instagram Ads source not added');
    console.log('✅ Update settings passed.');

    // 5. Create Admin User (saved in admins collection)
    console.log('\n5. Verifying Create Admin User (admins collection)...');
    const adminEmail = `test.admin.${Date.now()}@crm.com`;
    const createUserRes = await fetch(`${BASE_URL}/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Test Admin',
        email: adminEmail,
        password: 'adminpassword',
        role: 'admin',
        phone: '9876543211'
      })
    });
    const createUserData = await createUserRes.json();
    assert.strictEqual(createUserRes.status, 201, 'Failed to create Admin user');
    adminId = createUserData.data.user._id;
    console.log(`✅ Create Admin user passed. Email: ${adminEmail}`);

    // 6. Create Sales User (saved in users collection)
    console.log('\n6. Verifying Create Sales User (users collection)...');
    const salesEmail = `test.sales.${Date.now()}@crm.com`;
    const createSalesRes = await fetch(`${BASE_URL}/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Test Sales',
        email: salesEmail,
        password: 'salespassword',
        role: 'sales',
        phone: '9876543212'
      })
    });
    const createSalesData = await createSalesRes.json();
    assert.strictEqual(createSalesRes.status, 201, 'Failed to create Sales Rep user');
    salesRepId = createSalesData.data.user._id;
    console.log(`✅ Create Sales Rep user passed. Email: ${salesEmail}`);

    // 7. Get Users List (queries merged collections or by role)
    console.log('\n7. Verifying Get Users List (merged query)...');
    const getUsersRes = await fetch(`${BASE_URL}/users?role=sales`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    const getUsersData = await getUsersRes.json();
    assert.strictEqual(getUsersRes.status, 200, 'Failed to fetch users list');
    assert.ok(getUsersData.data.users.length > 0, 'Sales users array is empty');
    console.log('✅ Get users list passed. Found sales reps:', getUsersData.data.users.length);

    // 8. Create a Test Lead
    console.log('\n8. Verifying Create Test Lead...');
    const createLeadRes = await fetch(`${BASE_URL}/leads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'John Doe',
        phone: '9999988888',
        email: 'john.doe@example.com',
        source: 'Instagram Ads',
        priority: 'high',
        assignedTo: salesRepId,
        followUpDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Overdue by 1 day
      })
    });
    const createLeadData = await createLeadRes.json();
    assert.strictEqual(createLeadRes.status, 201, 'Failed to create lead');
    leadId = createLeadData.data.lead._id;
    console.log('✅ Lead creation passed.');

    // 9. Fetch Dashboard Stats (Categories should be calculated)
    console.log('\n9. Verifying Dashboard Categories & Stats...');
    const statsRes = await fetch(`${BASE_URL}/dashboard/stats`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    const statsData = await statsRes.json();
    assert.strictEqual(statsRes.status, 200, 'Failed to fetch dashboard stats');
    assert.ok(statsData.data.categories, 'Categories not defined in stats');
    console.log('✅ Dashboard categories verified:', statsData.data.categories);

    // 10. Fetch Sales Performance Analytics
    console.log('\n10. Verifying Performance Analytics...');
    const perfRes = await fetch(`${BASE_URL}/dashboard/performance`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    const perfData = await perfRes.json();
    assert.strictEqual(perfRes.status, 200, 'Failed to fetch performance analytics');
    console.log('✅ Performance analytics verified. Performance entries count:', perfData.data.performance.length);

    // 11. Fetch Calendar Events
    console.log('\n11. Verifying Calendar Range queries...');
    const todayStr = new Date().toISOString().split('T')[0];
    const nextWeekStr = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const prevWeekStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const calRes = await fetch(`${BASE_URL}/calendar?startDate=${prevWeekStr}&endDate=${nextWeekStr}`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    const calData = await calRes.json();
    assert.strictEqual(calRes.status, 200, 'Failed to fetch calendar events');
    console.log('✅ Calendar range query passed. Found events:', calData.data.events.length);

    // 12. Fetch Notifications (should trigger missed follow-up generation for overdue lead)
    console.log('\n12. Verifying Alert Generation & Notifications...');
    const notifRes = await fetch(`${BASE_URL}/notifications`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    const notifData = await notifRes.json();
    assert.strictEqual(notifRes.status, 200, 'Failed to fetch notifications');
    console.log('✅ Notifications retrieved. Count:', notifData.data.notifications.length);

    // 13. Export Excel File
    console.log('\n13. Verifying Excel Export...');
    const excelRes = await fetch(`${BASE_URL}/reports/export/excel`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(excelRes.status, 200, 'Excel export failed');
    assert.strictEqual(excelRes.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Invalid excel content type');
    console.log('✅ Excel report streamed successfully.');

    // 14. Export PDF File
    console.log('\n14. Verifying PDF Export...');
    const pdfRes = await fetch(`${BASE_URL}/reports/export/pdf`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(pdfRes.status, 200, 'PDF export failed');
    assert.strictEqual(pdfRes.headers.get('content-type'), 'application/pdf', 'Invalid PDF content type');
    console.log('✅ PDF report streamed successfully.');

    // 15. Toggle User Active Status (Deactivation test - checks dynamic lookup)
    console.log('\n15. Verifying Toggle User Active Status...');
    const toggleRes = await fetch(`${BASE_URL}/users/${salesRepId}/toggle-status`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    const toggleData = await toggleRes.json();
    assert.strictEqual(toggleRes.status, 200, 'Deactivation failed');
    assert.strictEqual(toggleData.data.user.active, false, 'User status was not set to false');
    console.log('✅ User deactivation passed.');

    console.log('\n⭐ ALL RESTRUCTURED VERIFICATION TESTS PASSED SUCCESSFULLY! ⭐');

  } catch (error) {
    console.error('\n❌ Restructured Verification Test Failed:', error.message);
    process.exit(1);
  }
}

runTests();
