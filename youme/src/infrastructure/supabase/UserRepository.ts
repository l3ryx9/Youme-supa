/**
 * Repository Supabase : Utilisateurs — remplace Firebase UserRepository
 */
import { supabase, TABLES } from './config';
import type { IUserRepository } from '@domain/repositories/IUserRepository';
import type { User, UserProfile, CreateUserDTO, UpdateUserDTO } from '@domain/entities/User';

export class UserRepository implements IUserRepository {
  /**
   * Crée un utilisateur avec son profil public.
   */
  async createUser(
    data: CreateUserDTO & { id: string; publicKeyB64?: string }
  ): Promise<User> {
    const now = new Date().toISOString();
    const username = data.username.toLowerCase();

    const userData = {
      id: data.id,
      email: data.email,
      username,
      display_name: data.displayName,
      is_online: true,
      last_seen: now,
      created_at: now,
      updated_at: now,
      is_email_verified: false,
      ai_enabled: true,
    };

    const { error: userError } = await supabase
      .from(TABLES.USERS)
      .insert(userData);
    if (userError) throw new Error(userError.message);

    // Registre des usernames (unicité)
    const { error: usernameError } = await supabase
      .from(TABLES.USERNAMES)
      .insert({ username, uid: data.id });
    if (usernameError) throw new Error(usernameError.message);

    // Profil public
    const { error: profileError } = await supabase
      .from(TABLES.PUBLIC_PROFILES)
      .insert({
        id: data.id,
        username,
        display_name: data.displayName,
        photo_url: null,
        bio: null,
        is_online: true,
        last_seen: now,
        ...(data.publicKeyB64 ? { e2e_public_key: data.publicKeyB64 } : {}),
      });
    if (profileError) throw new Error(profileError.message);

    return this.mapRowToUser(userData);
  }

  async getUserById(id: string): Promise<User | null> {
    const { data, error } = await supabase
      .from(TABLES.USERS)
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return this.mapRowToUser(data);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const { data, error } = await supabase
      .from(TABLES.USERS)
      .select('*')
      .eq('email', email)
      .single();
    if (error || !data) return null;
    return this.mapRowToUser(data);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const { data: usernameRow } = await supabase
      .from(TABLES.USERNAMES)
      .select('uid')
      .eq('username', username.toLowerCase())
      .single();
    if (!usernameRow) return null;
    return this.getUserById(usernameRow.uid);
  }

  async updateUser(id: string, data: UpdateUserDTO): Promise<User> {
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (data.displayName !== undefined) updates.display_name = data.displayName;
    if (data.photoURL !== undefined) updates.photo_url = data.photoURL;
    if (data.bio !== undefined) updates.bio = data.bio;
    if (data.isOnline !== undefined) updates.is_online = data.isOnline;
    if (data.aiEnabled !== undefined) updates.ai_enabled = data.aiEnabled;
    if (data.fcmToken !== undefined) updates.fcm_token = data.fcmToken;

    const { data: updated, error } = await supabase
      .from(TABLES.USERS)
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Sync profil public si displayName ou photoURL changé
    if (data.displayName !== undefined || data.photoURL !== undefined || data.isOnline !== undefined) {
      const profileUpdates: Record<string, any> = {};
      if (data.displayName !== undefined) profileUpdates.display_name = data.displayName;
      if (data.photoURL !== undefined) profileUpdates.photo_url = data.photoURL;
      if (data.isOnline !== undefined) profileUpdates.is_online = data.isOnline;
      await supabase.from(TABLES.PUBLIC_PROFILES).update(profileUpdates).eq('id', id);
    }

    return this.mapRowToUser(updated);
  }

  async deleteUser(id: string): Promise<void> {
    await supabase.from(TABLES.USERS).delete().eq('id', id);
    await supabase.from(TABLES.PUBLIC_PROFILES).delete().eq('id', id);
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const { data } = await supabase
      .from(TABLES.USERNAMES)
      .select('uid')
      .eq('username', username.toLowerCase())
      .single();
    return !data;
  }

  async getPublicProfile(id: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
      .from(TABLES.PUBLIC_PROFILES)
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return this.mapRowToProfile(data);
  }

  async searchUsersByUsername(searchQuery: string): Promise<UserProfile[]> {
    const { data, error } = await supabase
      .from(TABLES.PUBLIC_PROFILES)
      .select('*')
      .ilike('username', `%${searchQuery.toLowerCase()}%`)
      .limit(20);
    if (error || !data) return [];
    return data.map((row) => this.mapRowToProfile(row));
  }

  async searchUsers(searchQuery: string, currentUserId: string): Promise<UserProfile[]> {
    const results = await this.searchUsersByUsername(searchQuery);
    return results.filter((u) => u.id !== currentUserId);
  }

  async updateFcmToken(userId: string, token: string): Promise<void> {
    await supabase
      .from(TABLES.USERS)
      .update({ fcm_token: token, updated_at: new Date().toISOString() })
      .eq('id', userId);
  }

  subscribeToUser(id: string, callback: (user: User) => void): () => void {
    const channel = supabase
      .channel(`user:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: TABLES.USERS, filter: `id=eq.${id}` },
        (payload) => callback(this.mapRowToUser(payload.new))
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }

  private mapRowToUser(row: any): User {
    return {
      id: row.id,
      email: row.email ?? '',
      username: row.username ?? '',
      displayName: row.display_name ?? '',
      photoURL: row.photo_url ?? undefined,
      bio: row.bio ?? undefined,
      isOnline: row.is_online ?? false,
      lastSeen: row.last_seen ? new Date(row.last_seen) : new Date(),
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
      isEmailVerified: row.is_email_verified ?? false,
      aiEnabled: row.ai_enabled ?? true,
      fcmToken: row.fcm_token,
    };
  }

  private mapRowToProfile(row: any): UserProfile {
    return {
      id: row.id,
      username: row.username ?? '',
      displayName: row.display_name ?? '',
      photoURL: row.photo_url ?? undefined,
      bio: row.bio ?? undefined,
      isOnline: row.is_online ?? false,
      lastSeen: row.last_seen ? new Date(row.last_seen) : new Date(),
    };
  }
}

export const userRepository = new UserRepository();
