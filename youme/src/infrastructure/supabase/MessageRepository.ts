/**
 * Repository Supabase : Messages — remplace Firebase MessageRepository
 * Utilise Supabase Realtime (postgres_changes) pour les messages en temps réel.
 */
import { supabase, TABLES } from './config';
import type { IMessageRepository } from '@domain/repositories/IMessageRepository';
import type { Message, SendMessageDTO, AIAnalysisResult, MessageStatus } from '@domain/entities/Message';

export class MessageRepository implements IMessageRepository {
  async sendMessage(data: SendMessageDTO): Promise<Message> {
    const now = new Date().toISOString();
    const msgData = {
      conversation_id: data.conversationId,
      sender_id: data.senderId,
      receiver_id: data.receiverId,
      type: data.type,
      content: data.content,
      voice_local_path: data.voiceLocalPath ?? null,
      voice_duration: data.voiceDuration ?? null,
      image_local_path: data.imageLocalPath ?? null,
      video_local_path: data.videoLocalPath ?? null,
      storage_url: data.storageUrl ?? null,
      status: 'sent' as MessageStatus,
      is_deleted: false,
      ai_analysis: null,
      created_at: now,
      updated_at: now,
    };

    const { data: inserted, error } = await supabase
      .from(TABLES.MESSAGES)
      .insert(msgData)
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Mettre à jour le dernier message de la conversation
    await supabase
      .from(TABLES.CONVERSATIONS)
      .update({
        last_message: {
          id: inserted.id,
          type: data.type,
          content: data.content,
          sender_id: data.senderId,
          created_at: now,
          status: 'sent',
        },
        updated_at: now,
      })
      .eq('id', data.conversationId);

    return this.mapRow(inserted);
  }

  async getMessageById(id: string): Promise<Message | null> {
    const { data, error } = await supabase
      .from(TABLES.MESSAGES)
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return this.mapRow(data);
  }

  async getConversationMessages(
    conversationId: string,
    msgLimit = 50,
    before?: Date
  ): Promise<Message[]> {
    let query = supabase
      .from(TABLES.MESSAGES)
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
      .limit(msgLimit);

    if (before) {
      query = query.lt('created_at', before.toISOString());
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => this.mapRow(row));
  }

  async updateMessageStatus(id: string, status: MessageStatus): Promise<void> {
    await supabase
      .from(TABLES.MESSAGES)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
  }

  async updateMessageAIAnalysis(id: string, analysis: AIAnalysisResult): Promise<void> {
    await supabase
      .from(TABLES.MESSAGES)
      .update({ ai_analysis: analysis, updated_at: new Date().toISOString() })
      .eq('id', id);
  }

  async updateMessageInConversation(
    conversationId: string,
    messageId: string,
    data: Partial<{ status: MessageStatus; aiAnalysis: AIAnalysisResult }>
  ): Promise<void> {
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (data.status !== undefined) updates.status = data.status;
    if (data.aiAnalysis !== undefined) updates.ai_analysis = data.aiAnalysis;

    await supabase
      .from(TABLES.MESSAGES)
      .update(updates)
      .eq('id', messageId)
      .eq('conversation_id', conversationId);
  }

  async deleteMessage(id: string): Promise<void> {
    await supabase
      .from(TABLES.MESSAGES)
      .update({
        is_deleted: true,
        content: 'Ce message a été supprimé.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  async deleteMessageInConversation(
    conversationId: string,
    messageId: string
  ): Promise<void> {
    await supabase
      .from(TABLES.MESSAGES)
      .update({
        is_deleted: true,
        content: 'Ce message a été supprimé.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageId)
      .eq('conversation_id', conversationId);
  }

  async searchMessages(conversationId: string, queryStr: string): Promise<Message[]> {
    const { data, error } = await supabase
      .from(TABLES.MESSAGES)
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('is_deleted', false)
      .ilike('content', `%${queryStr}%`);
    if (error) return [];
    return (data ?? []).map((row) => this.mapRow(row));
  }

  async ackMediaReceived(
    conversationId: string,
    messageId: string,
    storageUrl: string
  ): Promise<void> {
    // Supprimer le fichier du relay Supabase Storage
    try {
      const { deleteMediaFromStorage } = await import('./MediaUploadService');
      await deleteMediaFromStorage(storageUrl);
    } catch {}

    // Mettre storage_url à null dans la base
    await supabase
      .from(TABLES.MESSAGES)
      .update({ storage_url: null, updated_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('conversation_id', conversationId);
  }

  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void
  ): () => void {
    // Charger les messages existants d'abord
    this.getConversationMessages(conversationId).then(callback);

    // Écouter les nouveaux messages en temps réel
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLES.MESSAGES,
          filter: `conversation_id=eq.${conversationId}`,
        },
        async () => {
          // Recharger tous les messages à chaque changement
          const messages = await this.getConversationMessages(conversationId);
          callback(messages);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  async toggleReaction(
    conversationId: string,
    messageId: string,
    userId: string,
    emoji: string
  ): Promise<void> {
    const { data } = await supabase
      .from(TABLES.MESSAGES)
      .select('reactions')
      .eq('id', messageId)
      .single();

    const current: Record<string, string> = data?.reactions ?? {};
    let updated: Record<string, string>;

    if (current[userId] === emoji) {
      const { [userId]: _, ...rest } = current;
      updated = rest;
    } else {
      updated = { ...current, [userId]: emoji };
    }

    await supabase
      .from(TABLES.MESSAGES)
      .update({ reactions: updated, updated_at: new Date().toISOString() })
      .eq('id', messageId);
  }

  private mapRow(row: any): Message {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      type: row.type,
      content: row.content,
      voiceLocalPath: row.voice_local_path ?? undefined,
      voiceDuration: row.voice_duration ?? undefined,
      imageLocalPath: row.image_local_path ?? undefined,
      videoLocalPath: row.video_local_path ?? undefined,
      storageUrl: row.storage_url ?? undefined,
      status: row.status,
      aiAnalysis: row.ai_analysis ?? undefined,
      reactions: row.reactions ?? undefined,
      isDeleted: row.is_deleted ?? false,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
    };
  }
}

export const messageRepository = new MessageRepository();
