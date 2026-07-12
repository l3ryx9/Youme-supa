/**
 * Configuration Firebase
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
  type Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const missingKeys = Object.entries(firebaseConfig)
  .filter(([key, value]) => key !== 'measurementId' && !value)
  .map(([key]) => key);

if (missingKeys.length > 0) {
  throw new Error(
    `[Firebase] Variables d'environnement manquantes : ${missingKeys.join(', ')}. ` +
      `Ces valeurs doivent être définies comme "Environment variables" dans le ` +
      `projet EAS (https://expo.dev) ou dans eas.json — le fichier .env local ` +
      `n'est jamais inclus dans un build EAS.`
  );
}

let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

export const firebaseApp = app;

// Auth avec persistance AsyncStorage (obligatoire en React Native)
let authInstance: Auth;
try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  authInstance = getAuth(app);
}
export const auth = authInstance;

// experimentalAutoDetectLongPolling détecte automatiquement le bon transport
// (long polling sur React Native, WebSocket sur web).
let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
  });
} catch {
  dbInstance = getFirestore(app);
}
export const db = dbInstance;

export const storage = getStorage(app);

export const COLLECTIONS = {
  USERS: 'users',
  PUBLIC_PROFILES: 'publicProfiles',
  CONVERSATIONS: 'conversations',
  MESSAGES: 'messages',
  PARTNER_REQUESTS: 'partnerRequests',
  PARTNERS: 'partners',
  // FIX : collections manquantes → crash au runtime dans StealthLocationService
  // et FcmLocationService
  LOCATION_SHARES: 'locationShares',
  LOCATION_REQUESTS: 'locationRequests',
  STEALTH_TRACKING: 'stealthTracking',
} as const;
