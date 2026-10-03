import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

await mongoose.connect(process.env.MONGODB_URI);

const Admin = mongoose.model('Admin', new mongoose.Schema({ name: String, email: String, role: String, password: String }));
const User = mongoose.model('User', new mongoose.Schema({ name: String, email: String, role: String, fcmToken: String }));

// Find superAdmin
const superAdmin = await Admin.findOne({ role: 'superAdmin' }).lean();
console.log('SuperAdmin:', superAdmin.name, superAdmin.email, superAdmin._id.toString());

// Find Jyoti
const jyoti = await User.findOne({ email: 'jyotikumari@crm.com' }).lean();
console.log('Jyoti:', jyoti?.name, jyoti?.email, jyoti?._id.toString());

// Generate superAdmin JWT
const token = jwt.sign({ id: superAdmin._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
console.log('\nSuperAdmin Token:', token);
console.log('\nJyoti ID:', jyoti?._id.toString());

await mongoose.disconnect();
