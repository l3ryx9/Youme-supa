/**
 * Service Firebase Authentication
 */
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  onIdTokenChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth } from './config';

export interface AuthResult {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export class AuthService {
  /**
   * Attend que le jeton d'auth soit propagé à Firestore.
   * UNIQUEMENT pour l'inscription : sans ça, la 1re écriture Firestore
   * part sans jeton => permission-denied.
   * Pour la connexion, le jeton est déjà présent — inutile d'attendre.
   *
   * Timeout de sécurité à 6 secondes pour ne jamais bloquer indéfiniment.
   */
  private async waitForToken(user: FirebaseUser): Promise<void> {
    const TOKEN_TIMEOUT_MS = 6000;
    try {
      await Promise.race([
        (async () => {
          await user.getIdToken(true);
          await new Promise<void>((resolve) => {
            const unsub = onIdTokenChanged(auth, (u) => {
              if (u) { unsub(); resolve(); }
            });
          });
          await new Promise((r) => setTimeout(r, 500));
        })(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            console.warn('[AuthService] waitForToken: timeout 6s, on continue.');
            resolve();
          }, TOKEN_TIMEOUT_MS)
        ),
      ]);
    } catch {
      console.warn('[AuthService] waitForToken: erreur ignorée, on continue.');
    }
  }

  /**
   * Inscription — waitForToken nécessaire avant d'écrire dans Firestore.
   */
  async register(email: string, password: string): Promise<AuthResult> {
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await this.waitForToken(credential.user);
      await sendEmailVerification(credential.user);
      return {
        uid: credential.user.uid,
        email: credential.user.email!,
        emailVerified: credential.user.emailVerified,
      };
    } catch (error: any) {
      throw this.mapAuthError(error.code);
    }
  }

  /**
   * Connexion — PAS de waitForToken ici.
   * Le jeton est immédiatement disponible après signInWithEmailAndPassword.
   * Attendre onIdTokenChanged causait un blocage infini.
   */
  async login(email: string, password: string): Promise<AuthResult> {
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await credential.user.getIdToken(true).catch(() => {
        console.warn('[AuthService] getIdToken refresh échoué, on continue.');
      });
      return {
        uid: credential.user.uid,
        email: credential.user.email!,
        emailVerified: credential.user.emailVerified,
      };
    } catch (error: any) {
      throw this.mapAuthError(error.code);
    }
  }

  async logout(): Promise<void> {
    await signOut(auth);
  }

  async sendPasswordReset(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error: any) {
      throw this.mapAuthError(error.code);
    }
  }

  async resendEmailVerification(): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Aucun utilisateur connecté');
    await sendEmailVerification(user);
  }

  async deleteAccount(password: string): Promise<void> {
    const user = auth.currentUser;
    if (!user || !user.email) throw new Error('Aucun utilisateur connecté');
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
    await deleteUser(user);
  }

  getCurrentUser(): FirebaseUser | null {
    return auth.currentUser;
  }

  onAuthStateChanged(callback: (user: FirebaseUser | null) => void): () => void {
    return onAuthStateChanged(auth, callback);
  }

  private mapAuthError(code: string): Error {
    const errorMap: Record<string, string> = {
      // Firebase SDK v9+ — remplace user-not-found + wrong-password
      'auth/invalid-credential':        'Email ou mot de passe incorrect.',
      'auth/invalid-login-credentials': 'Email ou mot de passe incorrect.',
      // Rétrocompatibilité SDK ancien
      'auth/user-not-found':            'Email ou mot de passe incorrect.',
      'auth/wrong-password':            'Email ou mot de passe incorrect.',
      // Autres erreurs
      'auth/email-already-in-use':      'Cette adresse email est déjà utilisée.',
      'auth/invalid-email':             'Adresse email invalide.',
      'auth/operation-not-allowed':     "Cette opération n'est pas autorisée.",
      'auth/weak-password':             'Le mot de passe est trop faible (minimum 8 caractères).',
      'auth/user-disabled':             'Ce compte a été désactivé.',
      'auth/too-many-requests':         'Trop de tentatives. Réessayez dans quelques minutes.',
      'auth/network-request-failed':    'Erreur réseau. Vérifiez votre connexion internet.',
      'auth/requires-recent-login':     'Veuillez vous reconnecter pour effectuer cette action.',
    };
    return new Error(errorMap[code] ?? `Une erreur inattendue est survenue. (code: ${code})`);
  }
}

export const authService = new AuthService();
