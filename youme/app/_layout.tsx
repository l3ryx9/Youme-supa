/**
 * Layout Racine — Expo Router
 * Configure le thème, les fonts, les providers globaux et l'état d'auth.
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { themedAlert, ThemedAlertHost } from '@presentation/components/common/ThemedAlert';
import { View, AppState, AppStateStatus } from 'react-native';
import { Stack, router } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { authService } from '../src/infrastructure/firebase/AuthService';
import { userRepository } from '../src/infrastructure/firebase/UserRepository';
import { stealthLocationService } from '../src/infrastructure/location/StealthLocationService';
import { fcmLocationService } from '../src/infrastructure/location/FcmLocationService';
import { useAuthStore } from '../src/presentation/stores/authStore';
import { useUIStore } from '../src/presentation/stores/uiStore';
import { YOUME_DARK_THEME, YOUME_LIGHT_THEME } from '../src/shared/constants/theme';
import { aiOrchestrator } from '../src/ai/memory/AIOrchestrator';
import { notificationService } from '../src/infrastructure/notifications/NotificationService';
import { logError, formatErrorForUser, installGlobalErrorHandlers } from '../src/shared/utils/logger';

installGlobalErrorHandlers();

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

export default function RootLayout() {
  const { setUser, isAuthenticated } = useAuthStore();
  const { isDarkMode, loadPersistedState } = useUIStore();
  const theme = isDarkMode ? YOUME_DARK_THEME : YOUME_LIGHT_THEME;

  // FIX: évite d'appeler router.replace au premier montage (avant que le
  // navigateur soit prêt). index.tsx gère déjà la redirection initiale
  // via <Redirect>. Cet effet ne doit réagir qu'aux CHANGEMENTS ultérieurs
  // d'isAuthenticated (login / logout).
  const isMounted = useRef(false);

  // FIX: empêche les lectures Firestore concurrentes entre onAuthStateChanged
  // et login()/register() — on mémorise quel UID est en cours de chargement.
  const loadingUid = useRef<string | null>(null);

  // FIX : startListeningForStealthConfig n'était jamais appelé côté appareil
  // cible → la config écrite dans Firestore (stealthTracking/{uid}) n'était
  // jamais lue et le GPS ne démarrait donc jamais. On (dé)branche l'écoute
  // ici, en synchro avec le cycle de vie de l'auth (login/logout).
  const stealthUnsubscribeRef = useRef<(() => void) | null>(null);

  // FIX : le statut « en ligne / dernière connexion » n'était mis à jour
  // qu'au login/logout. Dès que l'app passait en arrière-plan (ou revenait
  // au premier plan) sans déconnexion explicite, isOnline/lastSeen restait
  // figé. On écoute désormais les changements d'AppState pour refléter
  // fidèlement la présence réelle de l'utilisateur.
  const currentUidRef = useRef<string | null>(null);

  const onLayoutRootView = useCallback(async () => {
    await SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    loadPersistedState();

    aiOrchestrator.initialize().catch((err) => logError('AIOrchestrator.initialize', err));

    const unsubscribe = authService.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        const authState = useAuthStore.getState();

        // Déjà chargé pour cet utilisateur
        if (authState.user?.id === firebaseUser.uid) return;

        // login()/register() sont en cours : ils chargent le profil eux-mêmes
        if (authState.isLoading) return;

        // FIX: un chargement concurrent pour ce même UID est déjà en cours
        if (loadingUid.current === firebaseUser.uid) return;

        loadingUid.current = firebaseUser.uid;
        try {
          const user = await userRepository.getUserById(firebaseUser.uid);
          if (user) {
            setUser(user);
            currentUidRef.current = firebaseUser.uid;
            await userRepository.updateOnlineStatus(firebaseUser.uid, true);
            await notificationService.registerForPushNotifications(firebaseUser.uid);

            // FIX : la Cloud Function sendMessageNotification lit le champ
            // `nativeFcmToken` (jeton FCM natif) sur le document utilisateur,
            // mais rien n'appelait jamais registerNativeFcmToken() — le champ
            // restait donc toujours vide et aucune notification n'était
            // jamais envoyée, même quand le destinataire avait bien accordé
            // la permission. notificationService.registerForPushNotifications
            // enregistre un jeton Expo dans un champ différent (`fcmToken`),
            // que la Cloud Function n'utilise pas.
            await fcmLocationService.registerNativeFcmToken(firebaseUser.uid);

            // FIX : démarre l'écoute de la config de suivi furtif pour CET
            // appareil. Sans cet appel, un appareil ciblé n'écoute jamais
            // stealthTracking/{uid} et ne démarre donc jamais le GPS même si
            // le demandeur a bien écrit la config côté Firestore.
            stealthUnsubscribeRef.current?.();
            stealthUnsubscribeRef.current = stealthLocationService.startListeningForStealthConfig(
              firebaseUser.uid
            );
          } else {
            logError('RootLayout.profileMissing', {
              code: 'profile/not-found',
              message: `Profil Firestore introuvable pour ${firebaseUser.uid}`,
            });
            themedAlert.alert(
              'Erreur',
              formatErrorForUser(
                { code: 'profile/not-found' },
                'Votre profil est introuvable. Veuillez réessayer de vous connecter.'
              )
            );
            setUser(null);
            await authService.logout();
          }
        } catch (error: any) {
          logError('RootLayout.loadUser', error);
          themedAlert.alert(
            'Erreur de connexion',
            formatErrorForUser(error, 'Impossible de charger votre profil. Veuillez réessayer.')
          );
          setUser(null);
          await authService.logout().catch(() => {});
        } finally {
          loadingUid.current = null;
        }
      } else {
        loadingUid.current = null;
        currentUidRef.current = null;
        setUser(null);

        // Déconnexion : coupe l'écoute et arrête tout suivi furtif en cours
        // sur cet appareil.
        stealthUnsubscribeRef.current?.();
        stealthUnsubscribeRef.current = null;
        stealthLocationService.stopStealthTracking();
        fcmLocationService.stopTokenRefreshListener();
      }
    });

    // Reflète isOnline/lastSeen selon que l'app est au premier plan ou non,
    // pour tout utilisateur actuellement connecté sur cet appareil.
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const uid = currentUidRef.current;
      if (!uid) return;
      userRepository
        .updateOnlineStatus(uid, nextState === 'active')
        .catch((err) => logError('RootLayout.updateOnlineStatus', err));
    };
    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      unsubscribe();
      appStateSubscription.remove();
      stealthUnsubscribeRef.current?.();
      stealthUnsubscribeRef.current = null;
    };
  }, []);

  // FIX: saute le premier appel (montage initial) — index.tsx redirige déjà
  // via <Redirect>. On ne réagit qu'aux changements suivants (login/logout).
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (isAuthenticated) {
      router.replace('/(app)/(tabs)/');
    } else {
      router.replace('/(auth)/login');
    }
  }, [isAuthenticated]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <PaperProvider theme={theme}>
          <StatusBar style="light" backgroundColor="#221812" />
          <ThemedAlertHost />
          <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(app)" options={{ headerShown: false }} />
              <Stack.Screen name="debug-logs" options={{ headerShown: false, presentation: 'modal' }} />
            </Stack>
          </View>
        </PaperProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
