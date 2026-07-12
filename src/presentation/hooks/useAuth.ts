/**
 * Hook useAuth — migré vers Supabase
 * Gère l'état d'authentification et les opérations d'auth.
 */
import { useCallback } from 'react';
import { router } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { authService } from '@infrastructure/supabase/AuthService';
import { userRepository } from '@infrastructure/supabase/UserRepository';
import { e2eCryptoService } from '@infrastructure/crypto/E2ECryptoService';
import { KeyStorage } from '@infrastructure/crypto/KeyStorage';
import type { RegisterFormData, LoginFormData } from '@shared/validators/authValidators';
import { logError, logInfo, formatErrorForUser } from '@shared/utils/logger';

const LOGIN_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} a pris plus de ${ms / 1000}s. Vérifiez votre connexion internet.`)),
        ms
      )
    ),
  ]);
}

export function useAuth() {
  const {
    user,
    isLoading,
    isAuthenticated,
    error,
    setUser,
    setLoading,
    setError,
    clearError,
    reset,
  } = useAuthStore();

  const register = useCallback(
    async (data: RegisterFormData): Promise<void> => {
      setLoading(true);
      clearError();
      try {
        const isAvailable = await userRepository.isUsernameAvailable(data.username);
        if (!isAvailable) {
          throw new Error('Ce username est déjà utilisé. Choisissez-en un autre.');
        }

        const authResult = await authService.register(data.email, data.password);

        let publicKeyB64: string | undefined;
        try {
          const kp = e2eCryptoService.generateKeyPair();
          publicKeyB64 = kp.publicKeyB64;
          await KeyStorage.savePrivateKey(authResult.uid, kp.privateKeyB64);
          await e2eCryptoService.initialize(authResult.uid);
        } catch (e2eErr) {
          console.warn('[useAuth.register] Génération clé E2E échouée :', e2eErr);
        }

        let newUser;
        try {
          newUser = await userRepository.createUser({
            id: authResult.uid,
            email: data.email,
            username: data.username,
            displayName: data.displayName,
            publicKeyB64,
          });
        } catch (e: any) {
          logError('register.createUser', { authUid: authResult.uid, message: e?.message ?? '' });
          throw new Error(
            formatErrorForUser(e, 'Impossible de créer votre profil. Vérifiez votre connexion et réessayez.')
          );
        }

        setUser(newUser);
      } catch (err: any) {
        logError('register', err);
        const formatted = formatErrorForUser(err, err.message ?? "Erreur lors de l'inscription");
        setError(formatted);
        throw new Error(formatted);
      } finally {
        setLoading(false);
      }
    },
    [setLoading, clearError, setUser, setError]
  );

  const login = useCallback(
    async (data: LoginFormData): Promise<void> => {
      setLoading(true);
      clearError();
      try {
        const authResult = await withTimeout(
          authService.login(data.email, data.password),
          LOGIN_TIMEOUT_MS,
          'Connexion'
        );

        const userProfile = await withTimeout(
          userRepository.getUserById(authResult.uid),
          LOGIN_TIMEOUT_MS,
          'Chargement profil'
        );

        if (!userProfile) {
          throw new Error('Profil introuvable. Contactez le support.');
        }

        try {
          await e2eCryptoService.initialize(authResult.uid);
        } catch (e2eErr) {
          console.warn('[useAuth.login] Init E2E échouée :', e2eErr);
        }

        setUser(userProfile);
        router.replace('/(app)/(tabs)');
      } catch (err: any) {
        logError('login', err);
        const formatted = formatErrorForUser(err, err.message ?? 'Erreur lors de la connexion');
        setError(formatted);
        throw new Error(formatted);
      } finally {
        setLoading(false);
      }
    },
    [setLoading, clearError, setUser, setError]
  );

  const logout = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      await authService.logout();
      reset();
      router.replace('/(auth)/login');
    } catch (err: any) {
      logError('logout', err);
      reset();
      router.replace('/(auth)/login');
    } finally {
      setLoading(false);
    }
  }, [setLoading, reset]);

  const deleteAccount = useCallback(
    async (password: string): Promise<void> => {
      if (!user) throw new Error('Aucun utilisateur connecté');
      setLoading(true);
      clearError();
      try {
        await userRepository.deleteUser(user.id);
        await authService.deleteAccount(password);
        reset();
        router.replace('/(auth)/login');
      } catch (err: any) {
        logError('deleteAccount', err);
        const formatted = formatErrorForUser(err, err.message ?? 'Erreur lors de la suppression du compte');
        setError(formatted);
        throw new Error(formatted);
      } finally {
        setLoading(false);
      }
    },
    [user, setLoading, setError, reset]
  );

  const sendPasswordReset = useCallback(
    async (email: string): Promise<void> => {
      setLoading(true);
      clearError();
      try {
        await authService.sendPasswordReset(email);
      } catch (err: any) {
        logError('sendPasswordReset', err);
        const formatted = formatErrorForUser(err, err.message ?? "Erreur lors de l'envoi de l'email");
        setError(formatted);
        throw new Error(formatted);
      } finally {
        setLoading(false);
      }
    },
    [setLoading, clearError, setError]
  );

  return {
    user,
    isLoading,
    isAuthenticated,
    error,
    register,
    login,
    logout,
    deleteAccount,
    sendPasswordReset,
    clearError,
  };
}
