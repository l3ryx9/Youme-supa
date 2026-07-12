/**
 * Repository Firebase : Messages
 * Implémente IMessageRepository avec Firestore.
 */
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { db, COLLECTIONS } from './config';
import type { IMessageRepository } from '@domain/repositories/IMessageRepository';
import type { Message, SendMessageDTO, AIAnalysisResult, MessageStatus } from '@domain/entities/Message';
import { deleteMediaFromStorage } from './MediaUploadService';

export class MessageRepository implements IMessageRepository {
  async sendMessage(data: SendMessageDTO): Promise<Message> {
    const now = new Date();
    const msgData = {
      conversationId: data.conversationId,
      senderId: data.senderId,
      receiverId: data.receiverId,
      type: data.type,
      content: data.content,
      voiceLocalPath: data.voiceLocalPath ?? null,
      voiceDuration: data.voiceDuration ?? null,
      imageLocalPath: data.imageLocalPath ?? null,
      videoLocalPath: data.videoLocalPath ?? null,
      storageUrl: data.storageUrl ?? null,
      status: 'sent',
      isDeleted: false,
      aiAnalysis: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const ref = await addDoc(
      collection(db, COLLECTIONS.CONVERSATIONS, data.conversationId, 'messages'),
      msgData
    );

    await updateDoc(doc(db, COLLECTIONS.CONVERSATIONS, data.conversationId), {
      lastMessage: {
        id: ref.id,
        type: data.type,
        content: data.content,
        senderId: data.senderId,
        createdAt: serverTimestamp(),
        status: 'sent',
      },
      updatedAt: serverTimestamp(),
    });

    return {
      id: ref.id,
      ...data,
      status: 'sent',
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getMessageById(id: string): Promise<Message | null> {
    return null;
  }

  async getConversationMessages(
    conversationId: string,
    msgLimit = 50,
    before?: Date
  ): Promise<Message[]> {
    let q = query(
      collection(db, COLLECTIONS.CONVERSATIONS, conversationId, 'messages'),
      where('isDeleted', '==', false),
      orderBy('createdAt', 'desc'),
      limit(msgLimit)
    );

    const snap = await getDocs(q);
    return snap.docs
      .map((d) => this.mapDoc(d.id, conversationId, d.data()))
      .reverse();
  }

  async updateMessageStatus(id: string, status: MessageStatus): Promise<void> {
    // Note: requires conversationId to update sub-collection document
  }

  async updateMessageAIAnalysis(
    id: string,
    analysis: AIAnalysisResult
  ): Promise<void> {
    // Note: requires conversationId
  }

  async updateMessageInConversation(
    conversationId: string,
    messageId: string,
    data: Partial<{ status: MessageStatus; aiAnalysis: AIAnalysisResult }>
  ): Promise<void> {
    await updateDoc(
      doc(db, COLLECTIONS.CONVERSATIONS, conversationId, 'messages', messageId),
      { ...data, updatedAt: serverTimestamp() }
    );
  }

  async deleteMessage(id: string): Promise<void> {
    // Soft delete — requires conversationId; see deleteMessageInConversation
  }

  async deleteMessageInConversation(
    conversationId: string,
    messageId: string
  ): Promise<void> {
    await updateDoc(
      doc(db, COLLECTIONS.CONVERSATIONS, conversationId, 'messages', messageId),
      { isDeleted: true, content: 'Ce message a été supprimé.', updatedAt: serverTimestamp() }
    );
  }

  async searchMessages(conversationId: string, queryStr: string): Promise<Message[]> {
    const snap = await getDocs(
      query(
        collection(db, COLLECTIONS.CONVERSATIONS, conversationId, 'messages'),
        where('isDeleted', '==', false),
        orderBy('createdAt', 'desc')
      )
    );
    const lower = queryStr.toLowerCase();
    return snap.docs
      .map((d) => this.mapDoc(d.id, conversationId, d.data()))
      .filter((m) => m.content.toLowerCase().includes(lower));
  }

  async markMessagesAsRead(conversationId: string, userId: string): Promise<void> {
    const snap = await getDocs(
      query(
        collection(db, COLLECTIONS.CONVERSATIONS, conversationId, 'messages'),
        where('receiverId', '==', userId),
        where('status', '!=', 'read')
      )
    );
    const batch = writeBatch(db);
    snap.docs.forEach((d) => {
      batch.update(d.ref, { status: 'read', updatedAt: serverTimestamp() });
    });
    await batch.commit();
  }

  /**
   * Acquitte la réception d'un média par le destinataire :
   *  1. Met storageUrl à null dans Firestore (plus besoin du relay)
   *  2. Passe le statut à 'delivered'
   *  3. Supprime le fichier de Firebase Storage
   *
   * À appeler APRÈS avoir confirmé que le fichier est bien en cache local.
   */
  async ackMediaReceived(
    conversationId: string,
    messageId: string,
    storageUrl: string
  ): Promise<void> {
    try {
      // Mettre à jour Firestore : storageUrl → null, status → delivered
      await updateDoc(
        doc(db, COLLECTIONS.CONVERSATIONS, conversationId, 'messages', messageId),
        {
          storageUrl: null,
          status: 'delivered',
          updatedAt: serverTimestamp(),
        }
      );

      // Supprimer le relay Storage maintenant que le cache est confirmé
      await deleteMediaFromStorage(storageUrl);
    } catch {
      // Silencieux : si le réseau est coupé, le storageUrl reste dans Firestore
      // et sera retenté au prochain lancement (le fichier est déjà en cache local)
    }
  }

  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void
  ): () => void {
    const q = query(
      collection(db, COLLECTIONS.CONVERSATIONS, conversationId, 'messages'),
      where('isDeleted', '==', false),
      orderBy('createdAt', 'asc')
    );
    return onSnapshot(q, (snap) => {
      const messages = snap.docs.map((d) => this.mapDoc(d.id, conversationId, d.data()));
      callback(messages);
    });
  }

  async toggleReaction(
    conversationId: string,
    messageId: string,
    userId: string,
    emoji: string
  ): Promise<void> {
    const ref = doc(db, COLLECTIONS.CONVERSATIONS, conversationId, 'messages', messageId);
    const snap = await getDoc(ref);
    const current: Record<string, string> = snap.data()?.reactions ?? {};

    if (current[userId] === emoji) {
      const { [userId]: _, ...rest } = current;
      await updateDoc(ref, { reactions: rest, updatedAt: serverTimestamp() });
    } else {
      await updateDoc(ref, {
        reactions: { ...current, [userId]: emoji },
        updatedAt: serverTimestamp(),
      });
    }
  }

  private mapDoc(id: string, conversationId: string, data: any): Message {
    return {
      id,
      conversationId,
      senderId: data.senderId,
      receiverId: data.receiverId,
      type: data.type,
      content: data.content,
      voiceLocalPath: data.voiceLocalPath ?? undefined,
      voiceDuration: data.voiceDuration ?? undefined,
      imageLocalPath: data.imageLocalPath ?? undefined,
      videoLocalPath: data.videoLocalPath ?? undefined,
      storageUrl: data.storageUrl ?? undefined,
      status: data.status,
      aiAnalysis: data.aiAnalysis ?? undefined,
      reactions: data.reactions ?? undefined,
      isDeleted: data.isDeleted ?? false,
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
      updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date(),
    };
  }
}

export const messageRepository = new MessageRepository();
