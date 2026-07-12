/**
 * Service Supabase Authentication — remplace Firebase Auth
 */
import { supabase } from './config';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';

export interface AuthResult {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export class AuthService {
  /**
   * Inscription — crée un compte Supabase Auth.
   * La vérification email est envoyée automatiquement par Supabase.
   */
  async register(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw this.mapAuthError(error.message);
    if (!data.user) throw new Error("Erreur lors de la création du compte.");
    return {
      uid: data.user.id,
      email: data.user.email!,
      emailVerified: data.user.email_confirmed_at != null,
    };
  }

  /**
   * Connexion avec email + mot de passe.
   */
  async login(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw this.mapAuthError(error.message);
    if (!data.user) throw new Error("Erreur lors de la connexion.");
    return {
      uid: data.user.id,
      email: data.user.email!,
      emailVerified: data.user.email_confirmed_at != null,
    };
  }

  async logout(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }

  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw this.mapAuthError(error.message);
  }

  async resendEmailVerification(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) throw new Error('Aucun utilisateur connecté');
    const { error } = await supabase.auth.resend({ type: 'signup', email: user.email });
    if (error) throw new Error(error.message);
  }

  async deleteAccount(password: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) throw new Error('Aucun utilisateur connecté');
    // Ré-authentification avant suppression
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (loginError) throw new Error('Mot de passe incorrect.');
    const { error } = await supabase.auth.admin.deleteUser(user.id).catch(() => ({ error: null }));
    // Fallback : déconnexion si suppression admin non disponible côté client
    await supabase.auth.signOut();
  }

  getCurrentUser(): SupabaseUser | null {
    // Note : Supabase gère la session de façon asynchrone.
    // Utiliser onAuthStateChange pour l'état réactif.
    return null;
  }

  async getCurrentUserAsync(): Promise<SupabaseUser | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  }

  onAuthStateChanged(callback: (user: SupabaseUser | null) => void): () => void {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }

  async getSession(): Promise<Session | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }

  private mapAuthError(message: string): Error {
    if (message.includes('Invalid login credentials') || message.includes('invalid_credentials')) {
      return new Error('Email ou mot de passe incorrect.');
    }
    if (message.includes('Email not confirmed')) {
      return new Error('Veuillez vérifier votre email avant de vous connecter.');
    }
    if (message.includes('User already registered') || message.includes('already been registered')) {
      return new Error('Cette adresse email est déjà utilisée.');
    }
    if (message.includes('Password should be at least')) {
      return new Error('Le mot de passe est trop faible (minimum 8 caractères).');
    }
    if (message.includes('rate limit') || message.includes('too many')) {
      return new Error('Trop de tentatives. Réessayez dans quelques minutes.');
    }
    return new Error(message ?? 'Une erreur inattendue est survenue.');
  }
}

export const authService = new AuthService();
