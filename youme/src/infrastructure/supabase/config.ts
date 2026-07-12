/**
 * Configuration Supabase — remplace Firebase
 * Projet : meqofipcazdqwodkwmie
 */
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[Supabase] Variables d\'environnement manquantes : EXPO_PUBLIC_SUPABASE_URL et/ou EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Définissez-les dans eas.json -> build.<profile>.env ou dans votre fichier .env local.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Équivalent des COLLECTIONS Firestore → tables Supabase PostgreSQL
export const TABLES = {
  USERS: 'users',
  PUBLIC_PROFILES: 'public_profiles',
  USERNAMES: 'usernames',
  CONVERSATIONS: 'conversations',
  MESSAGES: 'messages',
  PARTNER_REQUESTS: 'partner_requests',
  PARTNERS: 'partners',
  LOCATION_SHARES: 'location_shares',
  LOCATION_REQUESTS: 'location_requests',
  STEALTH_TRACKING: 'stealth_tracking',
} as const;
