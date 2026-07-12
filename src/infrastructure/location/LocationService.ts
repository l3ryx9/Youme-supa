/**
 * Service de Localisation — migré vers Supabase
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, AppStateStatus } from 'react-native';
import { MMKV } from 'react-native-mmkv';
import { supabase, TABLES } from '../supabase/config';
import { detectMockLocation, resetMockDetector } from './MockLocationDetector';
import type { LocationData } from '@domain/entities/Message';

export const BACKGROUND_LOCATION_TASK = 'YOUME_BACKGROUND_LOCATION';

const bgStore = new MMKV({ id: 'youme-location-bg' });
const BG_CONV_KEY = 'bgConversationId';
const BG_USER_KEY = 'bgUserId';

let bgConversationId: string | null = null;
let bgUserId: string | null = null;

function persistBgContext(conversationId: string, userId: string): void {
  bgConversationId = conversationId;
  bgUserId = userId;
  try {
    bgStore.set(BG_CONV_KEY, conversationId);
    bgStore.set(BG_USER_KEY, userId);
  } catch {}
}

function clearBgContext(): void {
  bgConversationId = null;
  bgUserId = null;
  try {
    bgStore.delete(BG_CONV_KEY);
    bgStore.delete(BG_USER_KEY);
  } catch {}
}

function resolveBgContext(): { conversationId: string | null; userId: string | null } {
  if (bgConversationId && bgUserId) {
    return { conversationId: bgConversationId, userId: bgUserId };
  }
  try {
    const conversationId = bgStore.getString(BG_CONV_KEY) ?? null;
    const userId = bgStore.getString(BG_USER_KEY) ?? null;
    bgConversationId = conversationId;
    bgUserId = userId;
    return { conversationId, userId };
  } catch {
    return { conversationId: null, userId: null };
  }
}

try { TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error) { console.warn('[LocationService BG] Erreur:', error.message); return; }
  if (!data?.locations?.length) return;

  const { conversationId, userId } = resolveBgContext();
  if (!conversationId || !userId) return;

  const location = data.locations[0];
  const mockResult = detectMockLocation(location);
  if (mockResult.shouldBlock) {
    console.warn('[LocationService BG] Position fictive bloquée (score:', mockResult.score, ')');
    return;
  }
  if (AppState.currentState !== 'active') {
    supabase.from(TABLES.LOCATION_SHARES).upsert({
      id: conversationId,
      user_id: userId,
      conversation_id: conversationId,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? null,
      speed: location.coords.speed ?? null,
      is_mocked: mockResult.isMocked,
      updated_at: new Date().toISOString(),
    }).then(() => {}).catch(() => {});
  }
}); } catch (e) { console.warn('[LocationService] TaskManager non disponible dans ce build :', e); }

export interface LiveLocationData extends LocationData {
  userId: string;
  conversationId: string;
}

class LocationService {
  private appStateSubscription: any = null;

  async requestPermissions(): Promise<boolean> {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') return false;
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    return bg === 'granted';
  }

  async startSharing(userId: string, conversationId: string): Promise<void> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) throw new Error("Permission de localisation refusée.");

    persistBgContext(conversationId, userId);

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (!isRegistered) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 10000,
        distanceInterval: 10,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'YouMe — Partage de position actif',
          notificationBody: 'Votre position est partagée avec votre partenaire.',
        },
      });
    }
  }

  async stopSharing(conversationId: string): Promise<void> {
    clearBgContext();
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRegistered) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    } catch {}
    try {
      await supabase.from(TABLES.LOCATION_SHARES).delete().eq('id', conversationId);
    } catch {}
  }

  subscribeToLocation(
    conversationId: string,
    callback: (data: LiveLocationData | null) => void
  ): () => void {
    // Charger la position actuelle
    supabase
      .from(TABLES.LOCATION_SHARES)
      .select('*')
      .eq('id', conversationId)
      .single()
      .then(({ data }) => {
        if (data) callback(this.mapRow(data));
      });

    // Écouter les mises à jour en temps réel
    const channel = supabase
      .channel(`location:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLES.LOCATION_SHARES,
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            callback(null);
          } else {
            callback(this.mapRow(payload.new));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  private mapRow(row: any): LiveLocationData {
    return {
      userId: row.user_id,
      conversationId: row.conversation_id ?? row.id,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy ?? null,
      speed: row.speed ?? null,
      isMocked: row.is_mocked ?? false,
      timestamp: row.updated_at ? new Date(row.updated_at) : new Date(),
    };
  }
}

export const locationService = new LocationService();
