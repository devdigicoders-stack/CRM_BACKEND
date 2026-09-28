import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { User } from './src/models/User.js';
import { Admin } from './src/models/Admin.js';
import { notifyUser } from './src/services/notificationService.js';
import { sendPushNotification } from './src/config/firebase.js';

async function main() {
  const targetEmail = 'devdigicoders@gmail.com';
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB.`);

  let user = await User.findOne({ email: targetEmail.toLowerCase() });
  let isAdmin = false;

  if (!user) {
    user = await Admin.findOne({ email: targetEmail.toLowerCase() });
    if (user) isAdmin = true;
  }

  if (!user) {
    console.error(`❌ User not found with email: ${targetEmail}`);
    process.exit(1);
  }

  console.log(`👤 Found user: ${user.name} (${user.email}) | Role: ${user.role} | Model: ${isAdmin ? 'Admin' : 'User'}`);
  console.log(`🔑 fcmToken: ${user.fcmToken || 'NOT SET / NULL'}`);
  console.log(`🔑 fcmTokens: ${JSON.stringify(user.fcmTokens || [])}`);

  if (!user.fcmToken && (!user.fcmTokens || user.fcmTokens.length === 0)) {
    console.warn(`⚠️ Warning: No FCM token found for this user in DB.`);
    console.log(`Please make sure the user is logged in on the newly installed app so the FCM token gets synced.`);
    process.exit(0);
  }

  const title = '🚀 Test CRM Notification';
  const body = `Hello ${user.name}, push notification is working perfectly on TT CRM!`;

  console.log(`Sending notification to user ID: ${user._id}...`);
  const result = await notifyUser(
    user._id,
    title,
    body,
    null,
    { source: 'manual_test_script', timestamp: new Date().toISOString() },
    'general'
  );

  console.log(`✅ Notification dispatched! DB Record ID: ${result?._id}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
