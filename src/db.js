const admin = require("firebase-admin");

function initFirebase() {
  if (admin.apps.length > 0) return;

  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (json) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      console.error("FIREBASE_SERVICE_ACCOUNT must be valid JSON");
      process.exit(1);
    }
    admin.initializeApp({ credential: admin.credential.cert(parsed) });
    return;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
    return;
  }

  console.error(
    "Missing Firebase credentials: set FIREBASE_SERVICE_ACCOUNT (JSON string) or GOOGLE_APPLICATION_CREDENTIALS (path to service account file)"
  );
  process.exit(1);
}

initFirebase();

const db = admin.firestore();

module.exports = { admin, db, FieldValue: admin.firestore.FieldValue };
