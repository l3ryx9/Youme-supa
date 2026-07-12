# YouMe Intelligente — Architecture Technique

## Vue d'ensemble

YouMe Intelligente suit une **Clean Architecture** (Hexagonale) adaptée à React Native + Expo. Chaque couche est isolée et testable indépendamment.

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                           │
│  Expo Router (screens) · Zustand (state) · RN Paper (UI)        │
├─────────────────────────────────────────────────────────────────┤
│                       AI LAYER                                   │
│  Whisper · DistilBERT · Gemma · Orchestrateur · Recherche       │
├─────────────────────────────────────────────────────────────────┤
│                     DOMAIN LAYER                                 │
│  Entities · Repository Interfaces · Use Cases                   │
├─────────────────────────────────────────────────────────────────┤
│                  INFRASTRUCTURE LAYER                            │
│  Firebase (Auth/Firestore) · SQLite · FileSystem · FCM          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Structure des Répertoires

```
youme-intelligente/
├── app/                          # Routes Expo Router (file-based routing)
│   ├── _layout.tsx               # Layout racine : providers, auth state
│   ├── (auth)/                   # Groupe non-authentifié
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── forgot-password.tsx
│   └── (app)/                    # Groupe authentifié
│       ├── (tabs)/               # Navigation par onglets
│       │   ├── index.tsx         # Liste des conversations
│       │   ├── partners.tsx      # Gestion des partenaires
│       │   ├── search.tsx        # Recherche IA sémantique
│       │   └── settings.tsx      # Paramètres & confidentialité
│       ├── chat/[id].tsx         # Écran de chat
│       └── ai-insights/[id].tsx  # Détail des analyses IA
│
├── src/
│   ├── domain/                   # Couche Domaine (pure TypeScript)
│   │   ├── entities/             # Types métier
│   │   │   ├── User.ts
│   │   │   ├── Message.ts
│   │   │   ├── Partner.ts
│   │   │   ├── Conversation.ts
│   │   │   └── Memory.ts
│   │   └── repositories/         # Interfaces (contrats)
│   │       ├── IUserRepository.ts
│   │       ├── IMessageRepository.ts
│   │       ├── IPartnerRepository.ts
│   │       └── IMemoryRepository.ts
│   │
│   ├── infrastructure/           # Couche Infrastructure (adaptateurs)
│   │   ├── firebase/
│   │   │   ├── config.ts         # Initialisation Firebase
│   │   │   ├── AuthService.ts    # Firebase Auth
│   │   │   ├── UserRepository.ts # Firestore users
│   │   │   ├── MessageRepository.ts
│   │   │   └── PartnerRepository.ts
│   │   ├── storage/
│   │   │   ├── VoiceMessageStorage.ts  # Stockage local audio (Expo FS)
│   │   │   └── LocalMemoryRepository.ts # SQLite + embeddings JSON
│   │   └── notifications/
│   │       └── NotificationService.ts  # Expo Notifications + FCM
│   │
│   ├── ai/                       # Couche IA (modèles locaux)
│   │   ├── whisper/
│   │   │   └── WhisperService.ts       # Transcription vocale
│   │   ├── emotion/
│   │   │   └── EmotionAnalysisService.ts # Analyse émotionnelle
│   │   ├── llm/
│   │   │   └── LLMService.ts           # Extraction d'entités
│   │   ├── inconsistency/
│   │   │   ├── InconsistencyDetector.ts # Détection locale
│   │   │   └── GeminiInconsistencyModule.ts # Analyse avancée (optionnel)
│   │   ├── memory/
│   │   │   └── AIOrchestrator.ts       # Pipeline coordinateur
│   │   └── search/
│   │       └── IntelligentSearch.ts    # Recherche sémantique
│   │
│   ├── presentation/             # Couche Présentation
│   │   ├── stores/               # État global (Zustand + MMKV)
│   │   │   ├── authStore.ts
│   │   │   ├── conversationStore.ts
│   │   │   ├── partnerStore.ts
│   │   │   └── uiStore.ts
│   │   ├── hooks/
│   │   │   └── useAuth.ts
│   │   └── components/
│   │       ├── common/           # Composants partagés
│   │       │   ├── Avatar.tsx
│   │       │   └── PasswordStrengthBar.tsx
│   │       ├── chat/             # Composants de messagerie
│   │       │   ├── MessageBubble.tsx
│   │       │   ├── VoiceMessagePlayer.tsx
│   │       │   └── VoiceRecorder.tsx
│   │       └── ai/               # Composants d'affichage IA
│   │           └── EmotionBadge.tsx
│   │
│   └── shared/                   # Utilitaires transversaux
│       ├── constants/
│       │   └── theme.ts          # Thème WhatsApp-like
│       ├── utils/
│       │   ├── dateUtils.ts      # Formatage des dates
│       │   └── vectorUtils.ts    # Calcul vectoriel
│       └── validators/
│           └── authValidators.ts # Schémas Zod
│
├── assets/                       # Ressources statiques
├── __tests__/                    # Tests unitaires
│   ├── unit/
│   │   ├── validators/
│   │   ├── services/
│   │   └── repositories/
│   └── mocks/
│       └── firebase.ts
├── firestore.rules               # Règles de sécurité Firestore
├── scripts/setup.sh              # Script de configuration
├── .env.example                  # Template des variables d'environnement
├── app.json                      # Configuration Expo
├── eas.json                      # Configuration EAS Build
├── babel.config.js
├── tsconfig.json
├── package.json
├── README.md
├── ARCHITECTURE.md               # Ce fichier
└── CONTRIBUTING.md
```

---

## Flux de Données

### Envoi d'un Message Texte

```
UI (ChatScreen)
  │
  ├─▶ messageRepository.sendMessage(...)
  │     └─▶ Firestore : conversations/{id}/messages
  │
  └─▶ aiOrchestrator.analyzeMessageAsync(message)   ← arrière-plan
        │
        ├─▶ emotionService.analyze(text)
        │     └─▶ DistilBERT ONNX (si disponible) ou heuristique
        │
        ├─▶ llmService.extractFromText(text)
        │     └─▶ Gemma/Qwen (si disponible) ou règles
        │
        └─▶ memoryRepository.saveMemoryEntry(...)
              └─▶ SQLite local (jamais Firestore)
```

### Envoi d'un Message Vocal

```
UI (VoiceRecorder) → Enregistrement Audio.Recording (Expo AV)
  │
  ├─▶ voiceStorage.save(uri, duration)
  │     └─▶ Expo FileSystem : documents/voice_messages/{id}.m4a
  │         [JAMAIS Firebase Storage]
  │
  ├─▶ messageRepository.sendMessage({type:'voice', voiceLocalPath})
  │     └─▶ Firestore : contenu="🎤 Message vocal", sans URL cloud
  │
  └─▶ aiOrchestrator.analyzeMessageAsync(message)   ← arrière-plan
        │
        ├─▶ whisperService.transcribe(localPath)
        │     └─▶ Whisper Tiny ONNX → texte transcrit
        │
        ├─▶ emotionService.analyze(transcription)
        ├─▶ llmService.extractFromText(transcription)
        └─▶ memoryRepository.saveMemoryEntry(...)
```

---

## Pipeline IA

```
Message reçu/envoyé
       │
       ▼
┌─────────────┐
│   Whisper   │  Transcription audio → texte (messages vocaux uniquement)
│   Tiny ONNX │  Modèle : ~75MB | Runtime : onnxruntime-react-native
└──────┬──────┘
       │ texte
       ▼
┌─────────────┐
│  DistilBERT │  Analyse émotionnelle (6 émotions + scores)
│  Emotion    │  Modèle : ~260MB | Fallback : heuristique mots-clés
└──────┬──────┘
       │ émotions + scores
       ▼
┌─────────────┐
│    LLM      │  Extraction : entités, tâches, lieux, dates, préférences
│  Gemma/Qwen │  Modèle : ~1.5GB (Q4) | Fallback : règles regex
└──────┬──────┘
       │ entités structurées
       ▼
┌─────────────┐
│  SQLite     │  Sauvegarde mémoire locale : MemoryEntry par catégorie
│  Local      │  (jamais en cloud — confidentialité garantie)
└─────────────┘
```

---

## Détection d'Incohérences

### Seuils de déclenchement

| Niveau | Condition | Action |
|--------|-----------|--------|
| 0      | Aucune incohérence détectée | Aucune alerte |
| 1-2    | 1-2 incohérences potentielles | Alerte locale légère |
| ≥ GEMINI_TRIGGER_COUNT | Plusieurs incohérences | Analyse Gemini (si configuré) |

### Principes éthiques obligatoires

- ✅ Toujours formulation probabiliste : "potentielle", "possible", "suggère"
- ✅ Toujours recommander la vérification manuelle
- ✅ Séparer faits observés (citations) et interprétations du modèle
- ✅ Proposer des hypothèses bénignes (oubli, confusion, évolution)
- ❌ Jamais d'accusations ou de certitudes
- ❌ Jamais de score de "mensonge" présenté comme définitif

---

## Stockage des Données

| Type de données | Stockage | Justification |
|-----------------|----------|---------------|
| Profils utilisateurs | Firestore | Multi-appareils, temps réel |
| Messages | Firestore (sous-collection) | Temps réel, chiffrement Firebase |
| Fichiers audio | Expo FileSystem local | Confidentialité — jamais Firebase Storage |
| Mémoire IA | SQLite local | Confidentialité totale — on-device |
| Préférences UI | MMKV local | Performance, persistance rapide |

---

## Sécurité

### Authentification
- Firebase Auth (Email/Password)
- Email de vérification obligatoire
- CAPTCHA lors de l'inscription et la connexion (hCaptcha)
- Réauthentification pour les actions sensibles (suppression de compte)

### Règles Firestore
- Chaque utilisateur accède uniquement à ses propres données
- Règle "deny all" par défaut
- Soft delete pour les messages (pas de suppression physique)
- Immutabilité des champs critiques (id, email, createdAt)

### Données locales
- Les fichiers audio et la mémoire IA restent sur l'appareil
- Export JSON disponible pour l'utilisateur (droit à la portabilité)
- Suppression complète sur demande (droit à l'effacement)

---

## Technologies

| Rôle | Technologie | Version |
|------|-------------|---------|
| Framework mobile | React Native + Expo | SDK 51 |
| Navigation | Expo Router | v3.5 |
| UI Design | React Native Paper (MD3) | v5 |
| État global | Zustand | v4 |
| Persistance état | MMKV | v2 |
| Base de données locale | expo-sqlite | v14 |
| Requêtes async | TanStack Query | v5 |
| Validation | Zod + React Hook Form | v3/v7 |
| Backend Auth | Firebase Auth | JS SDK v10 |
| Base de données cloud | Firestore | JS SDK v10 |
| Notifications | Expo Notifications + FCM | v0.28 |
| Audio | Expo AV | v14 |
| Animations | React Native Reanimated | v3 |
| Transcription | Whisper Tiny ONNX | v3 |
| Émotions | DistilBERT Emotion ONNX | - |
| LLM léger | Gemma 2B Q4 / Qwen 0.5B | - |
| Analyse avancée | Google Gemini API | 1.5 Flash |
| Tests | Jest + jest-expo | v29 |
| Build | EAS Build | CLI v10+ |
