#!/usr/bin/env bash
# =============================================================================
# YouMe Intelligente — Script de Configuration Initiale
# =============================================================================
# Usage : bash scripts/setup.sh
# Ce script configure l'environnement de développement pour YouMe Intelligente.
# =============================================================================

set -e

RESET="\033[0m"
GREEN="\033[32m"
BLUE="\033[34m"
YELLOW="\033[33m"
RED="\033[31m"
BOLD="\033[1m"

echo -e "${BOLD}${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║            YouMe Intelligente — Configuration               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${RESET}"

# Vérifications préalables
echo -e "\n${BLUE}[1/5] Vérification des prérequis...${RESET}"

if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js non trouvé. Installez Node.js >= 20 : https://nodejs.org${RESET}"
  exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo -e "${RED}✗ Node.js >= 20 requis (actuel: v${NODE_VERSION})${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node --version) détecté${RESET}"

if ! command -v npm &>/dev/null; then
  echo -e "${RED}✗ npm non trouvé${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ npm $(npm --version) détecté${RESET}"

# Configuration du fichier .env
echo -e "\n${BLUE}[2/5] Configuration des variables d'environnement...${RESET}"
if [ -f ".env" ]; then
  echo -e "${YELLOW}⚠ Fichier .env existant détecté — conservation${RESET}"
else
  cp .env.example .env
  echo -e "${GREEN}✓ Fichier .env créé depuis .env.example${RESET}"
  echo -e "${YELLOW}  ► Éditez .env et renseignez vos clés Supabase avant de continuer.${RESET}"
  echo -e "${YELLOW}  Variables requises :${RESET}"
  echo -e "${YELLOW}    SUPABASE_URL=https://xxxx.supabase.co${RESET}"
  echo -e "${YELLOW}    SUPABASE_ANON_KEY=eyJ...${RESET}"
  echo -e "${YELLOW}    SUPABASE_SERVICE_ROLE_KEY=eyJ...${RESET}"
fi

# Installation des dépendances
echo -e "\n${BLUE}[3/5] Installation des dépendances npm...${RESET}"
npm install --legacy-peer-deps
echo -e "${GREEN}✓ Dépendances installées${RESET}"

# Installation d'Expo CLI
echo -e "\n${BLUE}[4/5] Installation d'Expo CLI et EAS CLI...${RESET}"
if ! command -v expo &>/dev/null; then
  npm install -g expo-cli eas-cli
  echo -e "${GREEN}✓ Expo CLI et EAS CLI installés${RESET}"
else
  echo -e "${GREEN}✓ Expo CLI déjà installé : $(expo --version)${RESET}"
fi

# Configuration Supabase (buckets + vérification)
echo -e "\n${BLUE}[5/5] Configuration Supabase...${RESET}"

MISSING_VARS=()
REQUIRED_VARS=("SUPABASE_URL" "SUPABASE_ANON_KEY" "SUPABASE_SERVICE_ROLE_KEY")

if [ -f ".env" ]; then
  for var in "${REQUIRED_VARS[@]}"; do
    VALUE=$(grep "^${var}=" .env | cut -d'=' -f2)
    if [ -z "$VALUE" ] || [[ "$VALUE" == your_* ]] || [[ "$VALUE" == https://xxxx* ]]; then
      MISSING_VARS+=("$var")
    fi
  done
fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
  echo -e "${YELLOW}⚠ Variables Supabase non configurées dans .env :${RESET}"
  for var in "${MISSING_VARS[@]}"; do
    echo -e "${YELLOW}  - $var${RESET}"
  done
  echo -e "${YELLOW}  Éditez .env puis relancez : ${BOLD}node scripts/setup-supabase.mjs${RESET}"
else
  echo -e "${GREEN}✓ Variables Supabase détectées — lancement du setup automatique...${RESET}"
  node scripts/setup-supabase.mjs
fi

# Répertoire des modèles IA
mkdir -p models

# Résumé
echo -e "\n${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              Configuration terminée !                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo ""
echo -e "${BOLD}Prochaines étapes :${RESET}"
echo ""
echo "  1. Si ce n'est pas fait, appliquez le schéma SQL dans le dashboard Supabase :"
echo "     ${BOLD}supabase/migrations/001_initial_schema.sql${RESET}"
echo ""
echo "  2. Téléchargez les modèles IA dans ${BOLD}models/${RESET} :"
echo "     ├── models/whisper-tiny.onnx"
echo "     ├── models/emotion-distilbert.onnx"
echo "     └── models/gemma-2b-it-q4.gguf (optionnel — 1.5 GB)"
echo ""
echo "  3. Lancez l'application :"
echo ""
echo "     ${BOLD}npx expo start${RESET}        # Démarrage local"
echo "     ${BOLD}npm run test${RESET}           # Exécuter les tests"
echo "     ${BOLD}npm run build:android${RESET}  # Build Android (EAS)"
echo "     ${BOLD}npm run build:ios${RESET}      # Build iOS (EAS)"
echo ""
echo "  Voir ${BOLD}README.md${RESET} pour la documentation complète."
echo ""
