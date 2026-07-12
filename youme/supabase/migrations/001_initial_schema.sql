-- ============================================================
-- YouMe Intelligente — Schéma PostgreSQL complet (Supabase)
-- Projet : meqofipcazdqwodkwmie
-- Reconstruit fidèlement depuis les entités domaine et les
-- repositories Firebase originaux.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- TABLE : users
-- Profil privé — lisible uniquement par son propriétaire (RLS).
-- Correspond à Firestore collection "users".
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id                 UUID        PRIMARY KEY,  -- = auth.uid() Supabase
  email              TEXT        NOT NULL UNIQUE,
  username           TEXT        NOT NULL UNIQUE,
  display_name       TEXT        NOT NULL DEFAULT '',
  photo_url          TEXT,
  bio                TEXT,
  is_online          BOOLEAN     NOT NULL DEFAULT false,
  last_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_email_verified  BOOLEAN     NOT NULL DEFAULT false,
  ai_enabled         BOOLEAN     NOT NULL DEFAULT true,
  fcm_token          TEXT,          -- token Expo Push Notifications
  native_fcm_token   TEXT           -- token FCM natif (react-native-firebase)
);

-- ─────────────────────────────────────────────────────────────
-- TABLE : public_profiles
-- Profil public — lisible par tous les utilisateurs connectés.
-- Correspond à Firestore collection "publicProfiles".
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.public_profiles (
  id             UUID        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  username       TEXT        NOT NULL,
  display_name   TEXT        NOT NULL DEFAULT '',
  photo_url      TEXT,
  bio            TEXT,
  is_online      BOOLEAN     NOT NULL DEFAULT false,
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  e2e_public_key TEXT          -- clé publique X25519 (Base64) pour chiffrement E2E
);

-- ─────────────────────────────────────────────────────────────
-- TABLE : usernames
-- Registre d'unicité des usernames (lookup rapide).
-- Correspond à Firestore collection "usernames".
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usernames (
  username  TEXT  PRIMARY KEY,
  uid       UUID  NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────
-- TABLE : conversations
-- Conversation 1-to-1 entre deux utilisateurs.
-- id = [minUid, maxUid].sort().join('_')
-- Correspond à Firestore collection "conversations".
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id              TEXT        PRIMARY KEY,  -- format : "aaa_bbb" (UIDs triés)
  participant_ids UUID[]      NOT NULL,
  last_message    JSONB,                    -- { id, type, content, sender_id, created_at, status }
  unread_count    INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- TABLE : messages
-- Messages d'une conversation.
-- Dans Firebase c'était une sous-collection : conversations/{id}/messages/{id}.
-- Ici table plate avec conversation_id.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id   TEXT        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id         UUID        NOT NULL REFERENCES public.users(id),
  receiver_id       UUID        NOT NULL REFERENCES public.users(id),

  -- Type : text | voice | system | location | image | video
  type              TEXT        NOT NULL DEFAULT 'text',

  -- Contenu texte (peut être vide pour médias)
  content           TEXT        NOT NULL DEFAULT '',

  -- Chiffrement E2E (XSalsa20-Poly1305 via X25519 TweetNaCl)
  encrypted         BOOLEAN     NOT NULL DEFAULT false,
  nonce             TEXT,                    -- nonce Base64 (24 octets, unique par message)

  -- Médias locaux (chemins sur l'appareil expéditeur, jamais envoyés)
  voice_local_path  TEXT,
  voice_duration    FLOAT,
  image_local_path  TEXT,
  video_local_path  TEXT,

  -- Relay Storage Supabase (supprimé après téléchargement destinataire)
  storage_url       TEXT,

  -- Données de localisation (type = 'location')
  location          JSONB,                  -- { latitude, longitude, accuracy, speed, isMocked, timestamp }

  -- Statut livraison : sending | sent | delivered | read | failed
  status            TEXT        NOT NULL DEFAULT 'sent',

  is_deleted        BOOLEAN     NOT NULL DEFAULT false,

  -- Analyse IA locale (stockée après traitement sur l'appareil)
  ai_analysis       JSONB,                  -- AIAnalysisResult (emotions, entities, transcription…)

  -- Réactions emoji : { "userId": "❤️" }
  reactions         JSONB,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at      ON public.messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id       ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_status ON public.messages(receiver_id, status)
  WHERE is_deleted = false;

-- ─────────────────────────────────────────────────────────────
-- TABLE : partner_requests
-- Demandes de partenariat.
-- id = "{senderId}_{receiverId}" (déterministe)
-- Correspond à Firestore collection "partnerRequests".
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_requests (
  id                    TEXT        PRIMARY KEY,  -- "{senderId}_{receiverId}"
  sender_id             UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_username       TEXT        NOT NULL,
  sender_display_name   TEXT        NOT NULL,
  sender_photo_url      TEXT,
  receiver_id           UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Statut : pending | accepted | rejected
  status                TEXT        NOT NULL DEFAULT 'pending',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_requests_receiver ON public.partner_requests(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_partner_requests_sender   ON public.partner_requests(sender_id, status);

-- ─────────────────────────────────────────────────────────────
-- TABLE : partners
-- Relations de partenariat actives.
-- id = "{userId}_{partnerId}" (déterministe)
-- Chaque relation génère DEUX lignes (symétrique).
-- Correspond à Firestore collection "partners".
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partners (
  id                    TEXT        PRIMARY KEY,  -- "{userId}_{partnerId}"
  user_id               UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  partner_id            UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  partner_username      TEXT        NOT NULL,
  partner_display_name  TEXT        NOT NULL,
  partner_photo_url     TEXT,
  partner_is_online     BOOLEAN     NOT NULL DEFAULT false,
  partner_last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conversation_id       TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_partners_user_id ON public.partners(user_id);

-- ─────────────────────────────────────────────────────────────
-- TABLE : location_shares
-- Position partagée en temps réel (live location).
-- id = conversationId (une seule ligne par conversation active)
-- Correspond à Firestore collection "locationShares".
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.location_shares (
  id                TEXT        PRIMARY KEY,  -- = conversationId
  user_id           UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id   TEXT        NOT NULL,
  latitude          FLOAT       NOT NULL,
  longitude         FLOAT       NOT NULL,
  accuracy          FLOAT,
  speed             FLOAT,
  is_mocked         BOOLEAN     NOT NULL DEFAULT false,
  is_stealth_update BOOLEAN     NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- TABLE : location_requests
-- Demande de localisation ponctuelle (mode furtif).
-- id = targetUserId (TEXT)
-- Correspond à Firestore collection "locationRequests".
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.location_requests (
  id               TEXT        PRIMARY KEY,  -- = targetUserId
  conversation_id  TEXT        NOT NULL,
  requester_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- TABLE : stealth_tracking
-- Configuration du suivi furtif (tracking discret).
-- id = targetUserId (TEXT)
-- Correspond à Firestore collection "stealthTracking".
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stealth_tracking (
  id               TEXT        PRIMARY KEY,  -- = targetUserId
  enabled          BOOLEAN     NOT NULL DEFAULT true,
  requester_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id  TEXT        NOT NULL,
  activated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usernames          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_shares    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stealth_tracking   ENABLE ROW LEVEL SECURITY;

-- ── users : le propriétaire lit et modifie son profil ────────
CREATE POLICY "users_select_own"  ON public.users FOR SELECT  USING (auth.uid() = id);
CREATE POLICY "users_insert_own"  ON public.users FOR INSERT  WITH CHECK (auth.uid() = id);
CREATE POLICY "users_update_own"  ON public.users FOR UPDATE  USING (auth.uid() = id);
CREATE POLICY "users_delete_own"  ON public.users FOR DELETE  USING (auth.uid() = id);

-- ── public_profiles : lecture par tous les connectés ─────────
CREATE POLICY "profiles_select_auth"  ON public.public_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_own"   ON public.public_profiles FOR INSERT  WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own"   ON public.public_profiles FOR UPDATE  USING (auth.uid() = id);
CREATE POLICY "profiles_delete_own"   ON public.public_profiles FOR DELETE  USING (auth.uid() = id);

-- ── usernames : lecture par tous, écriture par son propriétaire
CREATE POLICY "usernames_select_auth"  ON public.usernames FOR SELECT TO authenticated USING (true);
CREATE POLICY "usernames_insert_own"   ON public.usernames FOR INSERT  WITH CHECK (auth.uid() = uid);
CREATE POLICY "usernames_delete_own"   ON public.usernames FOR DELETE  USING (auth.uid() = uid);

-- ── conversations : accès aux deux participants ───────────────
CREATE POLICY "conversations_participant" ON public.conversations FOR ALL
  USING (auth.uid() = ANY(participant_ids))
  WITH CHECK (auth.uid() = ANY(participant_ids));

-- ── messages : expéditeur et destinataire ────────────────────
CREATE POLICY "messages_select" ON public.messages FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "messages_insert" ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "messages_update" ON public.messages FOR UPDATE
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "messages_delete" ON public.messages FOR DELETE
  USING (auth.uid() = sender_id);

-- ── partner_requests : expéditeur ou destinataire ────────────
CREATE POLICY "partner_requests_access" ON public.partner_requests FOR ALL
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- ── partners : propriétaire de la ligne ──────────────────────
CREATE POLICY "partners_own" ON public.partners FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── location_shares : utilisateur ou partenaire (via partners) ─
CREATE POLICY "location_shares_access" ON public.location_shares FOR ALL
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.partners
      WHERE user_id = auth.uid()
        AND conversation_id = location_shares.conversation_id
    )
  )
  WITH CHECK (auth.uid() = user_id);

-- ── location_requests : cible ou demandeur ───────────────────
CREATE POLICY "location_requests_access" ON public.location_requests FOR ALL
  USING (auth.uid()::text = id OR auth.uid() = requester_id)
  WITH CHECK (auth.uid() = requester_id);

-- ── stealth_tracking : cible ou demandeur ────────────────────
CREATE POLICY "stealth_tracking_access" ON public.stealth_tracking FOR ALL
  USING (auth.uid()::text = id OR auth.uid() = requester_id)
  WITH CHECK (auth.uid() = requester_id);

-- ============================================================
-- REALTIME
-- Activer la publication des changements pour les tables
-- qui ont des abonnements temps réel dans l'application.
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
ALTER PUBLICATION supabase_realtime ADD TABLE public.public_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.partners;
ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.location_shares;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stealth_tracking;

-- ============================================================
-- STORAGE BUCKETS (à créer manuellement dans le Dashboard)
-- ============================================================
-- Bucket "avatars"     : public = true  (photos de profil persistantes)
--   Chemin : avatars/{userId}.jpg
--   Politique write : auth.uid() == userId
--
-- Bucket "temp-media"  : public = false (relay médias, supprimé après DL)
--   Chemin : temp_media/{uuid}.{ext}
--   Politique write : authentifié uniquement
--   Politique read  : authentifié uniquement (URL signée 1h)
