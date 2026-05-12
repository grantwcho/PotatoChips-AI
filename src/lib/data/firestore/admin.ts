import "server-only";

import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function createFirestoreCompatibilityApp() {
  if (getApps().length) {
    return getApp();
  }

  const projectId =
    process.env.FIRESTORE_COMPATIBILITY_PROJECT_ID ??
    process.env.FIREBASE_PROJECT_ID ??
    process.env.IDENTITY_PLATFORM_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT;
  const clientEmail =
    process.env.FIRESTORE_COMPATIBILITY_CLIENT_EMAIL ??
    process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (
    process.env.FIRESTORE_COMPATIBILITY_PRIVATE_KEY ??
    process.env.FIREBASE_PRIVATE_KEY
  )?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

const firestoreCompatibilityApp = createFirestoreCompatibilityApp();

export const firestoreCompatibilityDb = getFirestore(firestoreCompatibilityApp);
