-- ============================================================
-- YouMe — Schéma initial Supabase (migration depuis Firestore)
-- Projet : meqofipcazdqwodkwmie
-- ============================================================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Utilisateurs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id              UUID PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  username        TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL DEFAULT '',
  photo_url       TEXT,
  bio             TEXT,
  is_online       BOOLEAN NOT NULL DEFAULT false,
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_email_verified BOOLEAN NOT NULL DEFAULT false,
  ai_enabled      BOOLEAN NOT NULL DEFAULT true,
  fcm_token       TEXT,
  native_fcm_token TEXT
);

-- ─── Profils publics ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.public_profiles (
  id              UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  username        TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL DEFAULT '',
  photo_url       TEXT,
  bio             TEXT,
  is_online       BOOLEAN NOT NULL DEFAULT false,
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  e2e_public_key  TEXT
);

-- ─── Registre des usernames (unicité) ────────────────────────
CREATE TABLE IF NOT EXISTS public.usernames (
  username        TEXT PRIMARY KEY,
  uid             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
);

-- ─── Conversations ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id              TEXT PRIMARY KEY, -- format : "userId1_userId2" (triés)
  participant_ids UUID[] NOT NULL,
  last_message    JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Messages ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES public.users(id),
  receiver_id     UUID NOT NULL REFERENCES public.users(id),
  type            TEXT NOT NULL DEFAULT 'text', -- text | voice | image | video | location
  content         TEXT NOT NULL DEFAULT '',
  voice_local_path TEXT,
  voice_duration  FLOAT,
  image_local_path TEXT,
  video_local_path TEXT,
  storage_url     TEXT,
  status          TEXT NOT NULL DEFAULT 'sent', -- sent | delivered | read
  is_deleted      BOOLEAN NOT NULL DEFAULT false,
  ai_analysis     JSONB,
  reactions       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages(sender_id);

-- ─── Demandes de partenariat ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_requests (
  id                  TEXT PRIMARY KEY, -- format : "senderId_receiverId"
  sender_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_username     TEXT NOT NULL,
  sender_display_name TEXT NOT NULL,
  sender_photo_url    TEXT,
  receiver_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_requests_receiver ON public.partner_requests(receiver_id, status);

-- ─── Partenaires ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partners (
  id                   TEXT PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  partner_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  partner_username     TEXT NOT NULL,
  partner_display_name TEXT NOT NULL,
  partner_photo_url    TEXT,
  partner_is_online    BOOLEAN NOT NULL DEFAULT false,
  partner_last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conversation_id      TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_partners_user_id ON public.partners(user_id);

-- ─── Partages de localisation en temps réel ──────────────────
CREATE TABLE IF NOT EXISTS public.location_shares (
  id                 TEXT PRIMARY KEY, -- conversation_id
  user_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id    TEXT NOT NULL,
  latitude           FLOAT NOT NULL,
  longitude          FLOAT NOT NULL,
  accuracy           FLOAT,
  speed              FLOAT,
  is_mocked          BOOLEAN NOT NULL DEFAULT false,
  is_stealth_update  BOOLEAN NOT NULL DEFAULT false,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Demandes de localisation (furtive) ──────────────────────
CREATE TABLE IF NOT EXISTS public.location_requests (
  id             UUID PRIMARY KEY, -- target_user_id
  conversation_id TEXT NOT NULL,
  requester_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Suivi furtif ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stealth_tracking (
  id              UUID PRIMARY KEY, -- target_user_id
  enabled         BOOLEAN NOT NULL DEFAULT true,
  requester_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usernames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stealth_tracking ENABLE ROW LEVEL SECURITY;

-- Users : lecture propre, écriture propre
CREATE POLICY "users_select_own" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_update_own" ON public.users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "users_insert_own" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "users_delete_own" ON public.users FOR DELETE USING (auth.uid() = id);

-- Profils publics : lecture par tous les utilisateurs connectés
CREATE POLICY "profiles_select_authenticated" ON public.public_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_write_own" ON public.public_profiles FOR ALL USING (auth.uid() = id);

-- Usernames : lecture par tous, écriture propre
CREATE POLICY "usernames_select_authenticated" ON public.usernames FOR SELECT TO authenticated USING (true);
CREATE POLICY "usernames_insert_own" ON public.usernames FOR INSERT WITH CHECK (auth.uid() = uid);
CREATE POLICY "usernames_delete_own" ON public.usernames FOR DELETE USING (auth.uid() = uid);

-- Conversations : accès aux participants
CREATE POLICY "conversations_participant" ON public.conversations FOR ALL
  USING (auth.uid() = ANY(participant_ids));

-- Messages : accès aux participants de la conversation
CREATE POLICY "messages_select" ON public.messages FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
CREATE POLICY "messages_insert" ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "messages_update" ON public.messages FOR UPDATE
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- Partenaires : accès propre
CREATE POLICY "partners_own" ON public.partners FOR ALL USING (auth.uid() = user_id);

-- Demandes de partenariat : envoyeur ou destinataire
CREATE POLICY "partner_requests_access" ON public.partner_requests FOR ALL
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- Localisation : accès aux participants de la conversation
CREATE POLICY "location_shares_access" ON public.location_shares FOR ALL
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.partners
      WHERE user_id = auth.uid()
        AND conversation_id = location_shares.conversation_id
    )
  );

-- Demandes localisation / furtif : accès propre
CREATE POLICY "location_requests_own" ON public.location_requests FOR ALL
  USING (auth.uid() = id OR auth.uid() = requester_id);
CREATE POLICY "stealth_tracking_own" ON public.stealth_tracking FOR ALL
  USING (auth.uid() = id OR auth.uid() = requester_id);

-- ============================================================
-- Realtime — activer pour les tables temps réel
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.partners;
ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.location_shares;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stealth_tracking;
