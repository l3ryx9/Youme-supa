#!/usr/bin/env node
// =============================================================================
// YouMe Intelligente — Script de configuration Supabase automatisé
// =============================================================================
// Usage :
//   node scripts/setup-supabase.mjs
//
// Variables d'environnement requises (dans .env ou l'environnement) :
//   SUPABASE_URL              = https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY = eyJ...
// =============================================================================

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Couleurs console ────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', blue: '\x1b[34m',
  yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};
const log   = (msg) => console.log(`${c.blue}►${c.reset} ${msg}`);
const ok    = (msg) => console.log(`${c.green}✓${c.reset} ${msg}`);
const warn  = (msg) => console.log(`${c.yellow}⚠${c.reset} ${msg}`);
const error = (msg) => console.error(`${c.red}✗${c.reset} ${msg}`);
const title = (msg) => console.log(`\n${c.bold}${c.cyan}── ${msg} ──${c.reset}`);

// ─── Chargement .env ─────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

loadEnv();

const SUPABASE_URL             = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  error('Variables manquantes dans .env :');
  if (!SUPABASE_URL)              error('  SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) error('  SUPABASE_SERVICE_ROLE_KEY');
  console.log(`\nCréez un fichier ${c.bold}.env${c.reset} à la racine du projet :\n`);
  console.log('  SUPABASE_URL=https://xxxx.supabase.co');
  console.log('  SUPABASE_ANON_KEY=eyJ...');
  console.log('  SUPABASE_SERVICE_ROLE_KEY=eyJ...\n');
  process.exit(1);
}

const BASE = SUPABASE_URL.replace(/\/$/, '');
const HEADERS = {
  'apikey':        SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type':  'application/json',
};

// ─── Helper fetch ─────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { ok: res.ok, status: res.status, data: json };
}

// ─── 1. Appliquer le schéma SQL ───────────────────────────────────────────────
async function applySchema() {
  title('Étape 1 — Schéma SQL');

  const sqlPath = resolve(ROOT, 'supabase/migrations/001_initial_schema.sql');
  if (!existsSync(sqlPath)) {
    error(`Fichier SQL introuvable : ${sqlPath}`);
    return false;
  }

  const sql = readFileSync(sqlPath, 'utf8');

  // Supabase expose un endpoint SQL via la route /rest/v1/rpc si une fonction
  // exec_sql existe. On tente d'abord l'API Management (nécessite un PAT),
  // puis on guide l'utilisateur si indisponible.
  log('Envoi du schéma SQL via Supabase REST…');

  // Utilise la fonction pg_query si disponible (Supabase extensions)
  // sinon tombe sur l'endpoint /pg/query (API Management avec PAT)
  const res = await api('POST', '/rest/v1/rpc/exec_sql', { sql_query: sql });

  if (res.ok) {
    ok('Schéma SQL appliqué avec succès !');
    return true;
  }

  // L'endpoint exec_sql n'existe pas par défaut — on affiche les instructions
  warn("Impossible d'appliquer le SQL automatiquement (endpoint non disponible).");
  console.log(`
${c.bold}Action manuelle requise — 2 minutes :${c.reset}

  1. Ouvrez : ${c.cyan}${BASE.replace('supabase.co', 'supabase.com/dashboard/project/' + extractRef(BASE) + '/sql/new')}${c.reset}
  2. Copiez-collez le contenu de : ${c.bold}supabase/migrations/001_initial_schema.sql${c.reset}
  3. Cliquez ${c.bold}Run${c.reset}

  Astuce — copier rapidement :
  ${c.bold}cat supabase/migrations/001_initial_schema.sql | pbcopy${c.reset}  (macOS)
  ${c.bold}cat supabase/migrations/001_initial_schema.sql | xclip -sel clip${c.reset}  (Linux)
`);
  return false;
}

function extractRef(url) {
  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  return match ? match[1] : 'your-project';
}

// ─── 2. Créer les buckets Storage ─────────────────────────────────────────────
async function createBuckets() {
  title('Étape 2 — Buckets Storage');

  const buckets = [
    {
      id: 'avatars',
      name: 'avatars',
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,        // 5 MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
    {
      id: 'temp-media',
      name: 'temp-media',
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,       // 50 MB
      allowedMimeTypes: [
        'image/jpeg', 'image/png', 'image/webp',
        'video/mp4', 'video/quicktime',
        'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg',
      ],
    },
  ];

  // Récupérer les buckets existants
  const listRes = await api('GET', '/storage/v1/bucket');
  const existing = listRes.ok && Array.isArray(listRes.data)
    ? listRes.data.map(b => b.id)
    : [];

  for (const bucket of buckets) {
    if (existing.includes(bucket.id)) {
      ok(`Bucket "${bucket.id}" existe déjà — ignoré`);
      continue;
    }

    log(`Création du bucket "${bucket.id}" (public: ${bucket.public})…`);
    const res = await api('POST', '/storage/v1/bucket', {
      id:                bucket.id,
      name:              bucket.name,
      public:            bucket.public,
      file_size_limit:   bucket.fileSizeLimit,
      allowed_mime_types: bucket.allowedMimeTypes,
    });

    if (res.ok) {
      ok(`Bucket "${bucket.id}" créé`);
    } else {
      const msg = typeof res.data === 'object' ? res.data?.error || JSON.stringify(res.data) : res.data;
      error(`Bucket "${bucket.id}" — erreur ${res.status} : ${msg}`);
    }
  }
}

// ─── 3. Vérification finale ────────────────────────────────────────────────────
async function verify() {
  title('Étape 3 — Vérification');

  // Vérifier les buckets
  const bucketsRes = await api('GET', '/storage/v1/bucket');
  if (bucketsRes.ok && Array.isArray(bucketsRes.data)) {
    const ids = bucketsRes.data.map(b => b.id);
    for (const name of ['avatars', 'temp-media']) {
      if (ids.includes(name)) ok(`Bucket "${name}" ✓`);
      else                    warn(`Bucket "${name}" introuvable`);
    }
  } else {
    warn('Impossible de lister les buckets');
  }

  // Vérifier quelques tables via REST
  for (const table of ['users', 'messages', 'partners']) {
    const res = await api('GET', `/rest/v1/${table}?limit=0`);
    if (res.ok) ok(`Table "${table}" ✓`);
    else        warn(`Table "${table}" inaccessible (${res.status}) — le SQL a-t-il été appliqué ?`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}${c.blue}`);
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        YouMe Intelligente — Setup Supabase                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(c.reset);
  console.log(`Projet : ${c.cyan}${BASE}${c.reset}`);

  await applySchema();
  await createBuckets();
  await verify();

  console.log(`\n${c.bold}${c.green}`);
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    Setup terminé !                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(c.reset);
  console.log('Prochaines étapes :');
  console.log(`  ${c.bold}npx expo start${c.reset}   → lancer l'application`);
  console.log(`  ${c.bold}eas build${c.reset}        → build EAS (Android/iOS)\n`);
}

main().catch(err => {
  error(`Erreur fatale : ${err.message}`);
  process.exit(1);
});
