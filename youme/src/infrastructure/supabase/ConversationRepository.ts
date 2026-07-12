/**
 * Repository Supabase : Conversations — remplace la logique Firestore inline
 * (collection `conversations` + onSnapshot) qui était directement dans les
 * écrans. Encapsule ici la requête temps réel et la résolution des profils
 * partenaires.
 *
 * Table `conversations` :
 *   id TEXT, participant_ids UUID[], last_message JSONB, unread_count INT,
 *   created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
 *
 * Supabase Realtime (postgres_changes) remplace onSnapshot : à chaque
 * changement de la table, on recharge la liste de l'utilisateur.
 */
import { supabase, TABLES } from './config';
import { userRepository } from './UserRepository';
import type { ConversationWithPartner } from '@domain/entities/Conversation';

function mapLastMessage(raw: any): ConversationWithPartner['lastMessage'] {
  if (!raw) return undefined;
  return {
    id: raw.id,
    type: raw.type,
    content: raw.content,
    senderId: raw.sender_id ?? raw.senderId,
    createdAt: raw.created_at ? new Date(raw.created_at) : new Date(),
    status: raw.status,
  };
}

export class ConversationRepository {
  /**
   * Charge les conversations de l'utilisateur, enrichies du profil public du
   * partenaire (pseudo, avatar, statut en ligne).
   */
  async getConversationsWithPartner(userId: string): Promise<ConversationWithPartner[]> {
    const { data, error } = await supabase
      .from(TABLES.CONVERSATIONS)
      .select('*')
      .contains('participant_ids', [userId])
      .order('updated_at', { ascending: false });

    if (error || !data) return [];

    // Résolution des profils partenaires (dédupliqués pour éviter les lectures
    // redondantes quand plusieurs conversations partagent un même partenaire).
    const partnerIds = Array.from(
      new Set(
        data
          .map((row) => (row.participant_ids as string[]).find((id) => id !== userId))
          .filter((id): id is string => !!id)
      )
    );

    const profileEntries = await Promise.all(
      partnerIds.map(async (id) => [id, await userRepository.getPublicProfile(id)] as const)
    );
    const profiles = new Map(profileEntries);

    const convs: ConversationWithPartner[] = [];
    for (const row of data) {
      const partnerId = (row.participant_ids as string[]).find((id) => id !== userId);
      if (!partnerId) continue;

      const profile = profiles.get(partnerId);

      convs.push({
        id: row.id,
        participantIds: row.participant_ids,
        lastMessage: mapLastMessage(row.last_message),
        unreadCount: row.unread_count ?? 0,
        createdAt: row.created_at ? new Date(row.created_at) : new Date(),
        updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
        partnerId,
        partnerUsername: profile?.username ?? 'partenaire',
        partnerDisplayName: profile?.displayName ?? 'Partenaire',
        partnerPhotoURL: profile?.photoURL,
        partnerIsOnline: profile?.isOnline ?? false,
        partnerLastSeen: profile?.lastSeen ?? new Date(),
      });
    }

    return convs;
  }

  /**
   * Abonnement temps réel : émet immédiatement la liste courante, puis à chaque
   * changement de la table `conversations`.
   */
  subscribeToConversations(
    userId: string,
    callback: (conversations: ConversationWithPartner[]) => void
  ): () => void {
    this.getConversationsWithPartner(userId).then(callback).catch(() => callback([]));

    const channel = supabase
      .channel(`conversations:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: TABLES.CONVERSATIONS },
        async () => {
          const conversations = await this.getConversationsWithPartner(userId);
          callback(conversations);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  /**
   * Récupère les identifiants des participants d'une conversation.
   * Utilisé par l'écran de chat pour résoudre le partenaire quand il n'est pas
   * déjà présent dans le store.
   */
  async getParticipantIds(conversationId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from(TABLES.CONVERSATIONS)
      .select('participant_ids')
      .eq('id', conversationId)
      .single();
    if (error || !data) return [];
    return (data.participant_ids as string[]) ?? [];
  }

  async deleteConversation(id: string): Promise<void> {
    const { error } = await supabase.from(TABLES.CONVERSATIONS).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}

export const conversationRepository = new ConversationRepository();
