/**
 * Cloud Functions Firebase — YouMe Intelligente
 *
 * sendStealthLocationRequest
 * ──────────────────────────
 * Se déclenche à chaque création d'un document dans `locationRequests/{targetUserId}`.
 * Lit le token FCM natif de la cible, envoie un message silencieux, puis supprime
 * la demande (idempotence).
 *
 * sendMessageNotification
 * ───────────────────────
 * Se déclenche à chaque création d'un message dans
 * `conversations/{conversationId}/messages/{messageId}`.
 * Envoie une notification push au destinataire (background + killed state).
 *
 * PRÉREQUIS : plan Firebase Blaze (pay-as-you-go) pour le déploiement des
 * Cloud Functions. Le quota gratuit est de 2 M invocations / mois, ce qui
 * suffit largement pour un usage personnel.
 *
 * DÉPLOIEMENT :
 *   cd functions && npm install && npm run build
 *   firebase deploy --only functions
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

admin.initializeApp();

const REGION = 'europe-west1';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Renvoie le corps de notification selon le type de message. */
function notificationBody(type: string, content: string): string {
  switch (type) {
    case 'image':    return '📷 Photo';
    case 'video':    return '🎥 Vidéo';
    case 'voice':    return '🎤 Message vocal';
    case 'location': return '📍 Position partagée';
    case 'system':   return '';
    default:         return content.length > 120 ? content.slice(0, 117) + '…' : content;
  }
}

// ─── sendStealthLocationRequest ─────────────────────────────────────────────

export const sendStealthLocationRequest = onDocumentCreated(
  {
    document: 'locationRequests/{targetUserId}',
    region: REGION,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const targetUserId = event.params.targetUserId;
    const { conversationId, requesterId } = data as {
      conversationId: string;
      requesterId: string;
    };

    if (!conversationId || !requesterId) {
      await event.data?.ref.delete();
      return;
    }

    const stealthSnap = await admin.firestore()
      .collection('stealthTracking')
      .doc(targetUserId)
      .get();

    if (!stealthSnap.exists || stealthSnap.data()?.requesterId !== requesterId) {
      console.warn(`[YouMe] Demande de localisation non autorisée : ${requesterId} → ${targetUserId}`);
      await event.data?.ref.delete();
      return;
    }

    const userSnap = await admin.firestore()
      .collection('users')
      .doc(targetUserId)
      .get();

    const nativeFcmToken: string | undefined = userSnap.data()?.nativeFcmToken;
    if (!nativeFcmToken) {
      console.warn(`[YouMe] Pas de token FCM natif pour l'utilisateur ${targetUserId}`);
      await event.data?.ref.delete();
      return;
    }

    await admin.messaging().send({
      token: nativeFcmToken,
      data: {
        type: 'stealth_location_request',
        conversationId,
        targetUserId,
      },
      android: {
        priority: 'high',
        ttl: 60_000,
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'background',
        },
        payload: {
          aps: {
            'content-available': 1,
          },
        },
      },
    });

    console.log(`[YouMe] FCM stealth envoyé à ${targetUserId} pour conv ${conversationId}`);
    await event.data?.ref.delete();
  }
);

// ─── sendMessageNotification ─────────────────────────────────────────────────

export const sendMessageNotification = onDocumentCreated(
  {
    document: 'conversations/{conversationId}/messages/{messageId}',
    region: REGION,
  },
  async (event) => {
    const msg = event.data?.data();
    if (!msg) return;

    const { conversationId } = event.params;
    const { senderId, type, content, isDeleted } = msg as {
      senderId: string;
      type: string;
      content: string;
      isDeleted?: boolean;
    };

    // Ne pas notifier pour les messages système ou supprimés.
    if (type === 'system' || isDeleted) return;

    // Récupérer la conversation pour trouver le destinataire.
    const convSnap = await admin.firestore()
      .collection('conversations')
      .doc(conversationId)
      .get();

    if (!convSnap.exists) return;

    const participantIds: string[] = convSnap.data()?.participantIds ?? [];
    const receiverId = participantIds.find((id) => id !== senderId);
    if (!receiverId) return;

    // Récupérer le token FCM natif du destinataire.
    const receiverSnap = await admin.firestore()
      .collection('users')
      .doc(receiverId)
      .get();

    const nativeFcmToken: string | undefined = receiverSnap.data()?.nativeFcmToken;
    if (!nativeFcmToken) {
      console.warn(`[YouMe] Pas de token FCM pour le destinataire ${receiverId}`);
      return;
    }

    // Récupérer le nom d'affichage de l'expéditeur.
    const senderSnap = await admin.firestore()
      .collection('publicProfiles')
      .doc(senderId)
      .get();

    const senderName: string = senderSnap.data()?.displayName ?? 'YouMe';
    const body = notificationBody(type, content ?? '');
    if (!body) return;

    await admin.messaging().send({
      token: nativeFcmToken,
      notification: {
        title: senderName,
        body,
      },
      data: {
        type: 'new_message',
        conversationId,
        senderId,
      },
      android: {
        priority: 'high',
        ttl: 300_000,
        notification: {
          channelId: 'messages',
          sound: 'notification',
          priority: 'max',
          defaultVibrateTimings: false,
          vibrateTimingsMillis: [0, 250, 250, 250],
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            sound: 'notification.wav',
            badge: 1,
          },
        },
      },
    });

    console.log(`[YouMe] Notification envoyée à ${receiverId} (conv ${conversationId})`);
  }
);
