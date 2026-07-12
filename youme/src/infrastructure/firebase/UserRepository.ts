/**
 * Repository Firebase : Utilisateurs
 * Implémente IUserRepository avec Firestore.
 *
 * commitWithRetry — reconstruit un WriteBatch frais à chaque tentative
 * pour contourner les erreurs permission-denied en début de session
 * (le jeton d'auth n'est pas toujours propagé instantanément).
 */
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, COLLECTIONS } from './config';
import type { IUserRepository } from '@domain/repositories/IUserRepository';
import type { User, UserProfile, CreateUserDTO, UpdateUserDTO } from '@domain/entities/User';

const USERNAMES_COLLECTION = 'usernames';
const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 600;

/**
 * Exécute le builder de batch jusqu'à MAX_RETRIES fois.
 * Reconstruit un WriteBatch neuf à chaque tentative (un batch usagé
 * ne peut pas être réutilisé après un commit qui a échoué).
 */
async function commitWithRetry(
  buildBatch: () => Promise<ReturnType<typeof writeBatch>>
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Force le rafraîchissement du jeton avant chaque tentative
      if (attempt > 1 && auth.currentUser) {
        try {
          await auth.currentUser.getIdToken(true);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } catch {
          // Ignore — on tente le commit quand même
        }
      }
      const batch = await buildBatch();
      await batch.commit();
      return; // Succès
    } catch (err: any) {
      lastError = err;
      const isRetryable =
        err?.code === 'permission-denied' ||
        err?.code === 'unavailable' ||
        err?.code === 'unauthenticated';
      if (!isRetryable || attempt === MAX_RETRIES) throw err;
      console.warn(`[UserRepository] Tentative ${attempt}/${MAX_RETRIES} échouée (${err?.code}), nouvelle tentative...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw lastError;
}

export class UserRepository implements IUserRepository {
  private usersRef = collection(db, COLLECTIONS.USERS);

  /**
   * Crée un utilisateur avec son profil public et son entrée username.
   * Si publicKeyB64 est fourni (E2E), il est inclus dans le profil public
   * dès l'inscription pour que les partenaires puissent chiffrer les messages.
   *
   * FIX : e2ePublicKey était absent du batch → getSharedSecret échouait
   * avec "Clé publique absente" pour tous les nouveaux utilisateurs.
   */
  async createUser(
    data: CreateUserDTO & { id: string; publicKeyB64?: string }
  ): Promise<User> {
    const now = new Date();
    const username = data.username.toLowerCase();
    const user: User = {
      id: data.id,
      email: data.email,
      username,
      displayName: data.displayName,
      isOnline: true,
      lastSeen: now,
      createdAt: now,
      updatedAt: now,
      isEmailVerified: false,
      aiEnabled: true,
    };

    // Écriture atomique avec retry : profil privé + registre username + profil public.
    await commitWithRetry(async () => {
      const batch = writeBatch(db);

      batch.set(doc(db, COLLECTIONS.USERS, data.id), {
        ...user,
        lastSeen: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, USERNAMES_COLLECTION, username), { uid: data.id });

      // FIX : inclure e2ePublicKey dans le profil public dès la création
      batch.set(doc(db, COLLECTIONS.PUBLIC_PROFILES, data.id), {
        username,
        displayName: user.displayName,
        photoURL: null,
        bio: null,
        isOnline: true,
        lastSeen: serverTimestamp(),
        ...(data.publicKeyB64 ? { e2ePublicKey: data.publicKeyB64 } : {}),
      });

      return batch;
    });

    return user;
  }

  async getUserById(id: string): Promise<User | null> {
    const snap = await getDoc(doc(db, COLLECTIONS.USERS, id));
    if (!snap.exists()) return null;
    return this.mapDocToUser(snap.id, snap.data());
  }

  /**
   * Lit le profil PUBLIC d'un utilisateur (username, displayName, photoURL,
   * bio, isOnline, lastSeen). À utiliser pour toute lecture d'un autre
   * utilisateur — jamais getUserById, qui n'est lisible que par son
   * propriétaire (voir firestore.rules).
   */
  async getPublicProfile(id: string): Promise<UserProfile | null> {
    const snap = await getDoc(doc(db, COLLECTIONS.PUBLIC_PROFILES, id));
    if (!snap.exists()) return null;
    return this.mapDocToProfile(snap.id, snap.data());
  }

  async getUserByUsername(username: string): Promise<UserProfile | null> {
    const q = query(
      collection(db, COLLECTIONS.PUBLIC_PROFILES),
      where('username', '==', username.toLowerCase())
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const docSnap = snap.docs[0];
    return this.mapDocToProfile(docSnap.id, docSnap.data());
  }

  async updateUser(id: string, data: UpdateUserDTO): Promise<User> {
    const batch = writeBatch(db);
    batch.update(doc(db, COLLECTIONS.USERS, id), {
      ...data,
      updatedAt: serverTimestamp(),
    });

    const publicFields: Record<string, unknown> = {};
    for (const key of ['displayName', 'photoURL', 'bio'] as const) {
      if (key in data) publicFields[key] = (data as any)[key];
    }
    if (Object.keys(publicFields).length > 0) {
      batch.update(doc(db, COLLECTIONS.PUBLIC_PROFILES, id), publicFields);
    }
    await batch.commit();

    const updated = await this.getUserById(id);
    if (!updated) throw new Error('Utilisateur introuvable après mise à jour.');
    return updated;
  }

  async deleteUser(id: string): Promise<void> {
    const batch = writeBatch(db);
    batch.delete(doc(db, COLLECTIONS.USERS, id));
    batch.delete(doc(db, COLLECTIONS.PUBLIC_PROFILES, id));
    await batch.commit();
  }

  async updateOnlineStatus(id: string, isOnline: boolean): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.USERS, id), {
      isOnline,
      lastSeen: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, COLLECTIONS.PUBLIC_PROFILES, id), {
      isOnline,
      lastSeen: serverTimestamp(),
    });
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const snap = await getDoc(doc(db, USERNAMES_COLLECTION, username.toLowerCase()));
    return !snap.exists();
  }

  async updateFcmToken(id: string, token: string): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.USERS, id), {
      fcmToken: token,
      updatedAt: serverTimestamp(),
    });
  }

  async updateAiEnabled(id: string, enabled: boolean): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.USERS, id), {
      aiEnabled: enabled,
      updatedAt: serverTimestamp(),
    });
  }

  /**
   * Publie / met à jour la clé publique E2E dans le profil public.
   * À appeler si l'utilisateur régénère ses clés ou si la clé était absente
   * lors d'une inscription ancienne.
   */
  async publishE2EPublicKey(uid: string, publicKeyB64: string): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.PUBLIC_PROFILES, uid), {
      e2ePublicKey: publicKeyB64,
    });
  }

  async getE2EPublicKey(uid: string): Promise<string | null> {
    const snap = await getDoc(doc(db, COLLECTIONS.PUBLIC_PROFILES, uid));
    if (!snap.exists()) return null;
    return snap.data()?.e2ePublicKey ?? null;
  }

  async searchUsersByUsername(queryStr: string): Promise<UserProfile[]> {
    // Correspondance exacte obligatoire : l'utilisateur doit connaître
    // le username complet pour que le profil s'affiche.
    const lower = queryStr.trim().toLowerCase();
    if (!lower) return [];
    const q = query(
      collection(db, COLLECTIONS.PUBLIC_PROFILES),
      where('username', '==', lower)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => this.mapDocToProfile(d.id, d.data()));
  }

  // Alias pour compatibilité avec les anciens appelants
  async searchUsers(searchQuery: string, currentUserId: string): Promise<UserProfile[]> {
    const results = await this.searchUsersByUsername(searchQuery);
    return results.filter((u) => u.id !== currentUserId);
  }

  private mapDocToUser(id: string, data: any): User {
    return {
      id,
      email: data.email ?? '',
      username: data.username ?? '',
      displayName: data.displayName ?? '',
      photoURL: data.photoURL ?? undefined,
      bio: data.bio ?? undefined,
      isOnline: data.isOnline ?? false,
      lastSeen:
        data.lastSeen instanceof Timestamp
          ? data.lastSeen.toDate()
          : new Date(data.lastSeen ?? 0),
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate()
          : new Date(data.createdAt ?? 0),
      updatedAt:
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toDate()
          : new Date(data.updatedAt ?? 0),
      isEmailVerified: data.isEmailVerified ?? false,
      aiEnabled: data.aiEnabled ?? true,
      fcmToken: data.fcmToken,
    };
  }

  private mapDocToProfile(id: string, data: any): UserProfile {
    return {
      id,
      username: data.username ?? '',
      displayName: data.displayName ?? '',
      photoURL: data.photoURL ?? undefined,
      bio: data.bio ?? undefined,
      isOnline: data.isOnline ?? false,
      lastSeen:
        data.lastSeen instanceof Timestamp
          ? data.lastSeen.toDate()
          : new Date(data.lastSeen ?? 0),
    };
  }
}

export const userRepository = new UserRepository();
