import fs from 'fs';
import path from 'path';

const collectionPath = path.join(process.cwd(), 'postman_collection.json');
const rawData = fs.readFileSync(collectionPath, 'utf8');
const data = JSON.parse(rawData);

// Helper to create a request template
const createUserTemplate = (roleName, roleValue, defaultName, defaultEmail, defaultPhone, defaultPassword) => {
  return {
    name: `Create ${roleName}`,
    request: {
      auth: {
        type: 'bearer',
        bearer: [
          {
            key: 'token',
            value: '{{token}}',
            type: 'string'
          }
        ]
      },
      method: 'POST',
      header: [],
      body: {
        mode: 'raw',
        raw: JSON.stringify({
          name: defaultName,
          email: defaultEmail,
          password: defaultPassword,
          role: roleValue,
          phone: defaultPhone
        }, null, 4),
        options: {
          raw: {
            language: 'json'
          }
        }
      },
      url: {
        raw: '{{baseUrl}}/users',
        host: [
          '{{baseUrl}}'
        ],
        path: [
          'users'
        ]
      }
    },
    response: []
  };
};

const assignLeadToInstallerTemplate = () => {
  return {
    name: 'Assign Lead to Installer',
    request: {
      auth: {
        type: 'bearer',
        bearer: [
          {
            key: 'token',
            value: '{{token}}',
            type: 'string'
          }
        ]
      },
      method: 'PUT',
      header: [],
      body: {
        mode: 'raw',
        raw: JSON.stringify({
          installerId: 'installer_user_id_here'
        }, null, 4),
        options: {
          raw: {
            language: 'json'
          }
        }
      },
      url: {
        raw: '{{baseUrl}}/installation/leads/:id/assign-rep',
        host: [
          '{{baseUrl}}'
        ],
        path: [
          'installation',
          'leads',
          ':id',
          'assign-rep'
        ],
        variable: [
          {
            key: 'id',
            value: 'lead_id_here'
          }
        ]
      }
    },
    response: []
  };
};

// Define role creation templates
const createAccountantReq = createUserTemplate('Accountant', 'accountant', 'Suresh Accountant', 'suresh@crm.com', '9988776633', 'accountantpassword123');
const createCallingRepReq = createUserTemplate('Calling Rep', 'calling', 'Arjun Telecaller', 'arjun@crm.com', '9988775500', 'callingpassword123');
const createSalesRepReq = createUserTemplate('Sales Rep', 'sales', 'Amit Sales Rep', 'amit_sales@crm.com', '9988776655', 'salespassword123');
const createInstallerReq = createUserTemplate('Installer', 'installation', 'Imran Installer', 'imran@crm.com', '9988775522', 'installerpassword123');
const createCRMUserReq = createUserTemplate('CRM User', 'crmuser', 'Sanjay CRM User', 'sanjay@crm.com', '9988775533', 'crmuserpassword123');
const assignInstallerReq = assignLeadToInstallerTemplate();

// 1. Process Super Admin Panel
const superAdminFolder = data.item.find(f => f.name === 'Super Admin Panel');
if (superAdminFolder) {
  console.log('Original Super Admin Panel items:', superAdminFolder.item.length);
  // Keep: Super Admin Login (0), Create Super Admin (1), Create Admin (2)
  const keptStart = superAdminFolder.item.slice(0, 3);
  // Skip old Create Manager/Sales Rep and Create Calling Team User (which were items at indices 3 and 4)
  const rest = superAdminFolder.item.slice(5);

  // New list: keptStart + new creation templates + rest
  superAdminFolder.item = [
    ...keptStart,
    createAccountantReq,
    createCallingRepReq,
    createSalesRepReq,
    createInstallerReq,
    createCRMUserReq,
    ...rest
  ];
  console.log('Updated Super Admin Panel items:', superAdminFolder.item.length);
}

// 2. Process Admin Panel
const adminFolder = data.item.find(f => f.name === 'Admin Panel');
if (adminFolder) {
  console.log('Original Admin Panel items:', adminFolder.item.length);
  // Keep Login (0), Stats (1), Add Lead (2)
  const keptStart = adminFolder.item.slice(0, 3);
  const rest = adminFolder.item.slice(3);

  adminFolder.item = [
    ...keptStart,
    createAccountantReq,
    createCallingRepReq,
    createSalesRepReq,
    createInstallerReq,
    createCRMUserReq,
    assignInstallerReq,
    ...rest
  ];
  console.log('Updated Admin Panel items:', adminFolder.item.length);
}

// 3. Process Accountant Panel
const accountantFolder = data.item.find(f => f.name === 'Accountant Panel');
if (accountantFolder) {
  console.log('Original Accountant Panel items:', accountantFolder.item.length);
  // Filter out the old 'Create Accountant'
  accountantFolder.item = accountantFolder.item.filter(r => !r.name.includes('Create Accountant'));
  
  // Accountant has access to assignInstallerReq. We append it to the end of Accountant Panel for convenience
  accountantFolder.item.push(assignInstallerReq);
  console.log('Updated Accountant Panel items:', accountantFolder.item.length);
}

// 4. Process CRM Panel
const crmFolder = data.item.find(f => f.name === 'CRM Panel');
if (crmFolder) {
  console.log('Original CRM Panel items:', crmFolder.item.length);
  crmFolder.item = crmFolder.item.filter(r => !r.name.includes('Create Calling Rep'));
  console.log('Updated CRM Panel items:', crmFolder.item.length);
}

// 5. Process Sales Panel
const salesFolder = data.item.find(f => f.name === 'Sales Panel');
if (salesFolder) {
  console.log('Original Sales Panel items:', salesFolder.item.length);
  salesFolder.item = salesFolder.item.filter(r => !r.name.includes('Create Sales Rep'));
  console.log('Updated Sales Panel items:', salesFolder.item.length);
}

// 6. Process Installation Panel
const installationFolder = data.item.find(f => f.name === 'Installation Panel');
if (installationFolder) {
  console.log('Original Installation Panel items:', installationFolder.item.length);
  installationFolder.item = installationFolder.item.filter(r => !r.name.includes('Create Installer') && !r.name.includes('Assign Lead to Installer'));
  console.log('Updated Installation Panel items:', installationFolder.item.length);
}

// Format requests numbering to keep them clean
data.item.forEach(f => {
  f.item.forEach((r, idx) => {
    // Strip leading number if present, e.g. "1. Login" -> "Login"
    const cleanedName = r.name.replace(/^\d+\.\s*/, '');
    r.name = `${idx + 1}. ${cleanedName}`;
  });
});

fs.writeFileSync(collectionPath, JSON.stringify(data, null, "\t"), 'utf8');
console.log('✅ Collection reorganized successfully!');
