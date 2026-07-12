/**
 * Repository Supabase : Partenaires — remplace Firebase PartnerRepository
 * id des lignes partners = "{userId}_{partnerId}" (même convention que Firebase)
 */
import { supabase, TABLES } from './config';
import type { IPartnerRepository } from '@domain/repositories/IPartnerRepository';
import type { Partner, PartnerRequest, SendPartnerRequestDTO } from '@domain/entities/Partner';
import { userRepository } from './UserRepository';

function partnerRequestId(senderId: string, receiverId: string): string {
  return `${senderId}_${receiverId}`;
}

export class PartnerRepository implements IPartnerRepository {
  async sendPartnerRequest(data: SendPartnerRequestDTO): Promise<PartnerRequest> {
    const receiver = await userRepository.getUserByUsername(data.receiverUsername);
    if (!receiver) throw new Error('Utilisateur introuvable avec ce username.');

    const sender = await userRepository.getPublicProfile(data.senderId);
    if (!sender) throw new Error('Utilisateur expéditeur introuvable.');

    const alreadyPartner = await this.isPartner(data.senderId, receiver.id);
    if (alreadyPartner) throw new Error('Vous êtes déjà partenaires.');

    const requestId = partnerRequestId(data.senderId, receiver.id);

    const { data: existing } = await supabase
      .from(TABLES.PARTNER_REQUESTS)
      .select('status')
      .eq('id', requestId)
      .single();
    if (existing?.status === 'pending') throw new Error('Une demande est déjà en attente.');

    const now = new Date().toISOString();
    const reqData = {
      id: requestId,
      sender_id: data.senderId,
      sender_username: sender.username,
      sender_display_name: sender.displayName,
      sender_photo_url: sender.photoURL ?? null,
      receiver_id: receiver.id,
      status: 'pending',
      created_at: now,
      updated_at: now,
    };

    const { error } = await supabase.from(TABLES.PARTNER_REQUESTS).upsert(reqData);
    if (error) throw new Error(error.message);

    return {
      id: requestId,
      senderId: data.senderId,
      senderUsername: sender.username,
      senderDisplayName: sender.displayName,
      senderPhotoURL: sender.photoURL,
      receiverId: receiver.id,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async acceptPartnerRequest(requestId: string): Promise<void> {
    const { data: reqData, error: reqError } = await supabase
      .from(TABLES.PARTNER_REQUESTS)
      .select('*')
      .eq('id', requestId)
      .single();
    if (reqError || !reqData) throw new Error('Demande introuvable.');

    const senderId = reqData.sender_id as string;
    const receiverId = reqData.receiver_id as string;

    const [sender, receiver] = await Promise.all([
      userRepository.getPublicProfile(senderId),
      userRepository.getPublicProfile(receiverId),
    ]);
    if (!sender || !receiver) throw new Error('Utilisateurs introuvables.');

    const conversationId = [senderId, receiverId].sort().join('_');
    const now = new Date().toISOString();

    // 1. Marquer la demande comme acceptée
    await supabase
      .from(TABLES.PARTNER_REQUESTS)
      .update({ status: 'accepted', updated_at: now })
      .eq('id', requestId);

    // 2. Créer la conversation
    await supabase.from(TABLES.CONVERSATIONS).upsert({
      id: conversationId,
      participant_ids: [senderId, receiverId],
      unread_count: 0,
      created_at: now,
      updated_at: now,
    });

    // 3. Créer les deux lignes partenaires (id = "{userId}_{partnerId}")
    await supabase.from(TABLES.PARTNERS).upsert([
      {
        id: `${senderId}_${receiverId}`,
        user_id: senderId,
        partner_id: receiverId,
        partner_username: receiver.username,
        partner_display_name: receiver.displayName,
        partner_photo_url: receiver.photoURL ?? null,
        partner_is_online: receiver.isOnline,
        partner_last_seen: receiver.lastSeen.toISOString(),
        conversation_id: conversationId,
        created_at: now,
      },
      {
        id: `${receiverId}_${senderId}`,
        user_id: receiverId,
        partner_id: senderId,
        partner_username: sender.username,
        partner_display_name: sender.displayName,
        partner_photo_url: sender.photoURL ?? null,
        partner_is_online: sender.isOnline,
        partner_last_seen: sender.lastSeen.toISOString(),
        conversation_id: conversationId,
        created_at: now,
      },
    ]);
  }

  async rejectPartnerRequest(requestId: string): Promise<void> {
    await supabase
      .from(TABLES.PARTNER_REQUESTS)
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', requestId);
  }

  async cancelPartnerRequest(requestId: string): Promise<void> {
    await supabase.from(TABLES.PARTNER_REQUESTS).delete().eq('id', requestId);
  }

  async removePartner(userId: string, partnerId: string): Promise<void> {
    const conversationId = [userId, partnerId].sort().join('_');
    await Promise.all([
      supabase.from(TABLES.PARTNERS).delete()
        .eq('user_id', userId).eq('partner_id', partnerId),
      supabase.from(TABLES.PARTNERS).delete()
        .eq('user_id', partnerId).eq('partner_id', userId),
      supabase.from(TABLES.CONVERSATIONS).delete().eq('id', conversationId),
    ]);
  }

  async getPartners(userId: string): Promise<Partner[]> {
    const { data, error } = await supabase
      .from(TABLES.PARTNERS)
      .select('*')
      .eq('user_id', userId);
    if (error) return [];
    return (data ?? []).map((row) => this.mapPartner(row));
  }

  /**
   * Demandes reçues (= getPendingRequests dans l'interface Firebase)
   */
  async getPendingRequests(userId: string): Promise<PartnerRequest[]> {
    const { data } = await supabase
      .from(TABLES.PARTNER_REQUESTS)
      .select('*')
      .eq('receiver_id', userId)
      .eq('status', 'pending');
    return (data ?? []).map((row) => this.mapRequest(row));
  }

  /** Alias — utilisé par certains composants */
  async getPartnerRequests(userId: string): Promise<PartnerRequest[]> {
    return this.getPendingRequests(userId);
  }

  /**
   * Demandes envoyées (= getSentRequests dans l'interface Firebase)
   */
  async getSentRequests(userId: string): Promise<PartnerRequest[]> {
    const { data } = await supabase
      .from(TABLES.PARTNER_REQUESTS)
      .select('*')
      .eq('sender_id', userId)
      .eq('status', 'pending');
    return (data ?? []).map((row) => this.mapRequest(row));
  }

  async isPartner(userId: string, partnerId: string): Promise<boolean> {
    const { data } = await supabase
      .from(TABLES.PARTNERS)
      .select('id')
      .eq('user_id', userId)
      .eq('partner_id', partnerId)
      .single();
    return !!data;
  }

  subscribeToPartners(userId: string, callback: (partners: Partner[]) => void): () => void {
    this.getPartners(userId).then(callback);

    const channel = supabase
      .channel(`partners:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLES.PARTNERS,
          filter: `user_id=eq.${userId}`,
        },
        async () => {
          const partners = await this.getPartners(userId);
          callback(partners);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  subscribeToRequests(userId: string, callback: (requests: PartnerRequest[]) => void): () => void {
    this.getPendingRequests(userId).then(callback);

    const channel = supabase
      .channel(`partner_requests:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLES.PARTNER_REQUESTS,
          filter: `receiver_id=eq.${userId}`,
        },
        async () => {
          const requests = await this.getPendingRequests(userId);
          callback(requests);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  private mapPartner(row: any): Partner {
    return {
      userId: row.user_id,
      partnerId: row.partner_id,
      partnerUsername: row.partner_username,
      partnerDisplayName: row.partner_display_name,
      partnerPhotoURL: row.partner_photo_url ?? undefined,
      partnerIsOnline: row.partner_is_online ?? false,
      partnerLastSeen: row.partner_last_seen ? new Date(row.partner_last_seen) : new Date(),
      conversationId: row.conversation_id,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    };
  }

  private mapRequest(row: any): PartnerRequest {
    return {
      id: row.id,
      senderId: row.sender_id,
      senderUsername: row.sender_username,
      senderDisplayName: row.sender_display_name,
      senderPhotoURL: row.sender_photo_url ?? undefined,
      receiverId: row.receiver_id,
      status: row.status,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
    };
  }
}

export const partnerRepository = new PartnerRepository();
