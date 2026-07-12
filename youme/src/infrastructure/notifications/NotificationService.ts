/**
 * Service de Notifications Push — migré vers Supabase
 * Intègre Expo Notifications. Le token FCM est stocké dans Supabase.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { userRepository } from '@infrastructure/supabase/UserRepository';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export class NotificationService {
  private unsubscribeRef: (() => void) | null = null;

  async registerForPushNotifications(userId: string): Promise<string | null> {
    if (!Device.isDevice) {
      console.warn('[NotificationService] Émulateur — notifications non disponibles');
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[NotificationService] Permission de notification refusée');
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#E91E8C',
        sound: 'notification.wav',
      });
    }

    try {
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId;

      if (!projectId) {
        console.warn('[NotificationService] EAS projectId manquant');
        return null;
      }

      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

      // Sauvegarder le token dans Supabase
      await userRepository.updateFcmToken(userId, token);

      return token;
    } catch (error) {
      console.warn('[NotificationService] Erreur token Expo :', error);
      return null;
    }
  }

  setupNotificationListeners(
    onNotification: (notification: Notifications.Notification) => void,
    onResponse: (response: Notifications.NotificationResponse) => void
  ): () => void {
    const sub1 = Notifications.addNotificationReceivedListener(onNotification);
    const sub2 = Notifications.addNotificationResponseReceivedListener(onResponse);
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }
}

export const notificationService = new NotificationService();
