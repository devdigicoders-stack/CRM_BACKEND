import admin from 'firebase-admin';

const firebaseConfigured = !!(
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
);

if (firebaseConfigured) {
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
      console.log('✅ Firebase Admin initialized successfully');
    }
  } catch (err) {
    console.error('[Firebase] Init failed:', err.message);
  }
} else {
  console.warn('[Firebase] Credentials not set. Push notifications disabled.');
}

export const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (!admin.apps.length) {
    console.warn('[FCM] Firebase not initialized, skipping push.');
    return;
  }
  try {
    console.log(`[FCM] Sending push to token: ${fcmToken?.substring(0, 20)}...`);
    const response = await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data,
    });
    console.log('[FCM] ✅ Push sent successfully. MessageId:', response);
  } catch (err) {
    console.error('[FCM] ❌ Send error:', err.message);
  }
};

export default admin;
