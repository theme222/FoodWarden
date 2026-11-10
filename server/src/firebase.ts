import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const useEmulators = import.meta.env.VITE_USE_EMULATORS === "true";
const { VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID } =
  import.meta.env;

const configured = useEmulators || Boolean(
  VITE_FIREBASE_API_KEY && VITE_FIREBASE_AUTH_DOMAIN && VITE_FIREBASE_PROJECT_ID && VITE_FIREBASE_APP_ID,
);

function initializeServices() {
  const projectId = VITE_FIREBASE_PROJECT_ID || "demo-foodwarden";
  const app = initializeApp({
    projectId,
    apiKey: VITE_FIREBASE_API_KEY || "demo-foodwarden-key",
    authDomain: VITE_FIREBASE_AUTH_DOMAIN || projectId + ".firebaseapp.com",
    appId: VITE_FIREBASE_APP_ID || "1:1:web:foodwarden",
  });
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:" + (import.meta.env.VITE_EMULATOR_AUTH_PORT || "9099"), {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, "127.0.0.1", Number(import.meta.env.VITE_EMULATOR_FIRESTORE_PORT || 8080));
  }
  return { auth, db };
}

export const services = configured ? initializeServices() : null;
