import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

const firebaseConfigured = !!(
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
);

let app = null;

if (firebaseConfigured) {
  try {
    if (getApps().length === 0) {
      let privateKey = process.env.FIREBASE_PRIVATE_KEY;
      if (privateKey) {
        if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
          try {
            privateKey = JSON.parse(privateKey);
          } catch {
            privateKey = privateKey.slice(1, -1);
          }
        }
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      app = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        }),
      });
      console.log('✅ Firebase Admin initialized successfully');
    } else {
      app = getApps()[0];
    }
  } catch (err) {
    console.error('[Firebase] Init failed:', err.message);
  }
} else {
  console.warn('[Firebase] Credentials not set. Push notifications disabled.');
}

export const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (getApps().length === 0) {
    console.warn('[FCM] Firebase not initialized, skipping push.');
    return;
  }
  try {
    console.log(`[FCM] Sending push to token: ${fcmToken?.substring(0, 20)}...`);
    const stringData = {};
    if (data && typeof data === 'object') {
      Object.keys(data).forEach((key) => {
        stringData[key] = String(data[key]);
      });
    }

    const response = await getMessaging().send({
      token: fcmToken,
      notification: { title, body },
      data: stringData,
    });
    console.log('[FCM] ✅ Push sent successfully. MessageId:', response);
  } catch (err) {
    console.error('[FCM] ❌ Send error:', err.message);
  }
};

export default app;
