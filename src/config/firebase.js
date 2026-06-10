const firebaseConfigured = !!(
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
);

let admin = null;

if (firebaseConfigured) {
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
  } catch (err) {
    console.warn('[Firebase] Init failed:', err.message);
    admin = null;
  }
} else {
  console.warn('[Firebase] Credentials not set. Push notifications disabled.');
}

export const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (!admin) return;
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data,
    });
  } catch (err) {
    console.error('FCM send error:', err.message);
  }
};

export default admin;
