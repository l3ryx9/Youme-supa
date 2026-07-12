# YouMe Intelligente 🤖💬

Application de messagerie privée 1-to-1 avec **IA locale** et **Supabase** comme backend.

**Stack :** React Native + Expo SDK 51 · Supabase · Clean Architecture · SQLite · MMKV

---

## Fonctionnalités

### 💬 Messagerie
- Messages texte et vocaux en temps réel (Supabase Realtime)
- Accusés de réception et de lecture (✓✓ bleu style WhatsApp)
- Suppression de messages (soft delete)
- Indicateur de statut en ligne
- Design sombre inspiré de WhatsApp — palette « Nuit Rose »

### 🎙️ Messages Vocaux
- Enregistrement avec pause/reprise
- Stockage **exclusivement local** (jamais envoyé en cloud)
- Lecture avec barre de progression et visualisation waveform
- Transcription automatique avec Whisper Tiny

### 🤖 Intelligence Artificielle Locale
- **Whisper Tiny** : transcription des messages vocaux
- **DistilBERT Emotion** : analyse émotionnelle (6 émotions, scores probabilistes)
- **Gemma 2B / Qwen 0.5B** : extraction d'entités (personnes, lieux, dates, tâches, projets...)
- **Mémoire IA** : SQLite local avec résumés et timeline
- **Recherche sémantique** : requêtes en langage naturel sur la mémoire

### 🔍 Détection d'Incohérences
- Analyse probabiliste — jamais de certitudes, toujours des indicateurs
- Formulation éthique obligatoire : "incohérence potentielle", "vérification recommandée"
- Module Gemini optionnel pour analyse approfondie (API gratuite)

### 🔐 Sécurité & Confidentialité
- Authentification Supabase Auth (email + vérification)
- Règles RLS Supabase strictes (données privées par défaut)
- Données IA 100% locales (SQLite, FileSystem)
- Export et suppression des données à la demande

---

## Installation Rapide

### Prérequis
- Node.js >= 20
- Expo CLI : `npm install -g expo-cli`
- EAS CLI : `npm install -g eas-cli`
- Un projet Supabase (https://supabase.com)

### 1. Cloner et installer

```bash
git clone https://github.com/l3ryx9/Youme-supa.git
cd Youme-supa
npm install --legacy-peer-deps
cp .env.example .env
```

### 2. Configurer Supabase

1. Ouvrez [dashboard.supabase.com/project/meqofipcazdqwodkwmie](https://supabase.com/dashboard/project/meqofipcazdqwodkwmie)
2. Allez dans **Settings → API** et copiez :
   - **URL du projet** → `EXPO_PUBLIC_SUPABASE_URL`
   - **Clé anon publique** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
3. Renseignez ces valeurs dans votre fichier `.env`

### 3. Appliquer le schéma de base de données

Dans le **SQL Editor** de Supabase, exécutez le fichier :
```
supabase/migrations/001_initial_schema.sql
```

Cela crée toutes les tables (users, messages, conversations, partners...) avec les politiques RLS.

### 4. Configurer le Storage Supabase

Créez deux buckets dans **Storage** :
- `avatars` — public, pour les photos de profil
- `temp-media` — privé, pour le relay de médias (images/vidéos)

### 5. Lancer l'application

```bash
npx expo start          # QR code pour Expo Go
npx expo start --android # Émulateur Android
npx expo start --ios    # Simulateur iOS
```

---

## Architecture

```
src/
├── ai/                    # Modules IA locaux (Whisper, DistilBERT, Gemma)
├── domain/                # Entités et interfaces (Clean Architecture)
├── infrastructure/
│   ├── supabase/          # ← Couche Supabase (auth, users, messages, partners...)
│   ├── crypto/            # Chiffrement bout-en-bout (TweetNaCl)
│   ├── location/          # Partage de position (Supabase Realtime)
│   ├── notifications/     # Notifications push (Expo)
│   └── storage/           # Stockage local (SQLite, MMKV, FileSystem)
├── presentation/
│   ├── components/        # Composants React Native réutilisables
│   ├── hooks/             # Hooks React personnalisés
│   └── stores/            # État global (Zustand)
└── shared/                # Utilitaires, constantes, validateurs
```

## Migration Firebase → Supabase

| Firebase | Supabase |
|---------|----------|
| Firestore | PostgreSQL + Supabase Realtime |
| Firebase Auth | Supabase Auth |
| Firebase Storage | Supabase Storage |
| Cloud Functions | Supabase Edge Functions (à venir) |

---

## Consignes d'utilisation

- L'application est conçue pour une utilisation **strictement privée** entre deux partenaires.
- Les fonctionnalités d'IA (analyse émotionnelle, détection d'incohérences) fonctionnent **entièrement en local** : aucune donnée de conversation n'est envoyée vers des serveurs tiers.
- Le module Gemini est **optionnel** et nécessite une clé API séparée. Sans cette clé, l'analyse Gemini est désactivée.
- Le mode de localisation furtive est destiné à un usage **parental** uniquement.
- Les messages vocaux sont stockés **localement** sur l'appareil et ne transitent jamais par le cloud.
