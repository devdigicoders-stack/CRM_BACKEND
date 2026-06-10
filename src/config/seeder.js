import { Admin } from '../models/Admin.js';

export const seedSuperAdmin = async () => {
  try {
    const superAdminExists = await Admin.findOne({ role: 'superAdmin' });
    if (!superAdminExists) {
      console.log('🌱 No Super Admin found. Seeding default Super Admin...');
      await Admin.create({
        name: 'Super Admin',
        email: 'superadmin@crm.com',
        password: 'admin12345',
        role: 'superAdmin',
        phone: '1234567890',
      });
      console.log('✅ Super Admin seeded successfully in admins collection: superadmin@crm.com / admin12345');
    } else {
      console.log('ℹ️ Super Admin already exists in admins collection.');
    }
  } catch (error) {
    console.error('❌ Error seeding Super Admin:', error.message);
  }
};
