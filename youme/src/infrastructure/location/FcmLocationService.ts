/**
 * Service de localisation furtive à la demande (Supabase).
 *
 * Historique : ce service reposait auparavant sur un token FCM natif
 * (@react-native-firebase/messaging) + un push silencieux pour déclencher une
 * remontée de position en arrière-plan. Depuis la migration vers Supabase, les
 * demandes passent par la table `location_requests` + Supabase Realtime, et la
 * dépendance Firebase native a été entièrement retirée.
 */
import { supabase, TABLES } from '../supabase/config';

class FcmLocationService {
  /**
   * Conservé pour compatibilité d'appel (app/_layout.tsx). Le token FCM natif
   * n'est plus utilisé : les demandes de position passent désormais par Supabase.
   */
  async registerNativeFcmToken(_userId: string): Promise<void> {
    // No-op : plus de token FCM natif depuis la migration Supabase.
  }

  /** No-op : plus d'écouteur de rafraîchissement de token natif. */
  stopTokenRefreshListener(): void {}

  async requestLocationFromTarget(
    targetUserId: string,
    conversationId: string,
    requesterId: string
  ): Promise<void> {
    await supabase.from(TABLES.LOCATION_REQUESTS).upsert({
      id: targetUserId,
      conversation_id: conversationId,
      requester_id: requesterId,
      requested_at: new Date().toISOString(),
    });
  }
}

export const fcmLocationService = new FcmLocationService();
