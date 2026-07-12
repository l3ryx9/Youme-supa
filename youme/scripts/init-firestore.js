#!/usr/bin/env node
/**
 * Script d'initialisation Firestore — YouMe Intelligente
 * ========================================================
 * Crée toutes les collections (avec un document `_init` de départ) et
 * déploie les index composites définis dans `firestore.indexes.json`.
 *
 * Firestore ne "crée" jamais une collection vide : elle apparaît dès
 * qu'un document y est ajouté. Ce script ajoute donc un document
 * `_init` (sûr à supprimer ensuite) dans chaque collection top-level,
 * puis crée les index composites via l'API Admin Firestore.
 *
 * Prérequis :
 *   npm install --save-dev firebase-admin @google-cloud/firestore
 *
 * Authentification (une des deux options) :
 *   1) Variable d'env FIREBASE_SERVICE_ACCOUNT_JSON contenant le JSON
 *      complet de la clé de compte de service (recommandé, pas de fichier
 *      sur disque).
 *   2) Variable d'env GOOGLE_APPLICATION_CREDENTIALS pointant vers un
 *      fichier de clé de compte de service.
 *
 * Usage :
 *   node scripts/init-firestore.js
 *   node scripts/init-firestore.js --skip-indexes   (collections uniquement)
 *   node scripts/init-firestore.js --skip-collections (index uniquement)
 */

const fs = require('fs');
const path = require('path');

const COLLECTIONS = ['users', 'conversations', 'partnerRequests', 'partners'];

const INDEXES_FILE = path.join(__dirname, '..', 'firestore.indexes.json');

function loadServiceAccount() {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inlineJson) {
    return JSON.parse(inlineJson);
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && fs.existsSync(credPath)) {
    return JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  }

  console.error(
    '\n[init-firestore] Aucune credential trouvée.\n' +
      'Définissez FIREBASE_SERVICE_ACCOUNT_JSON (contenu JSON complet de la clé)\n' +
      'ou GOOGLE_APPLICATION_CREDENTIALS (chemin vers le fichier .json).\n'
  );
  process.exit(1);
}

async function createCollections(serviceAccount) {
  const admin = require('firebase-admin');

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  console.log(`\n[init-firestore] Projet : ${serviceAccount.project_id}`);
  console.log('[init-firestore] Création des collections...\n');

  for (const name of COLLECTIONS) {
    const ref = db.collection(name).doc('_init');
    await ref.set(
      {
        _init: true,
        _note: 'Document placeholder créé par scripts/init-firestore.js — supprimable une fois de vraies données présentes.',
        createdAt: now,
      },
      { merge: true }
    );
    console.log(`  ✓ Collection "${name}" prête (doc _init créé/mis à jour)`);
  }

  console.log(
    '\n[init-firestore] Note : la sous-collection "conversations/{id}/messages" est créée automatiquement dès le premier message et ne peut pas être pré-créée sans conversation existante.\n'
  );
}

async function createIndexes(serviceAccount) {
  const { v1 } = require('@google-cloud/firestore');

  if (!fs.existsSync(INDEXES_FILE)) {
    console.error(`[init-firestore] Fichier introuvable : ${INDEXES_FILE}`);
    process.exit(1);
  }

  const { indexes } = JSON.parse(fs.readFileSync(INDEXES_FILE, 'utf-8'));
  const projectId = serviceAccount.project_id;
  const client = new v1.FirestoreAdminClient({ credentials: serviceAccount, projectId });
  const parent = client.collectionGroupPath(projectId, '(default)', '_placeholder_').split('/collectionGroups/')[0];

  console.log(`[init-firestore] Création de ${indexes.length} index composite(s)...\n`);

  for (const index of indexes) {
    const collectionGroupPath = `${parent}/collectionGroups/${index.collectionGroup}`;
    const fields = index.fields.map((f) => ({
      fieldPath: f.fieldPath,
      order: f.order ? (f.order === 'ASCENDING' ? 'ASCENDING' : 'DESCENDING') : undefined,
      arrayConfig: f.arrayConfig ? 'CONTAINS' : undefined,
    }));

    try {
      const [operation] = await client.createIndex({
        parent: collectionGroupPath,
        index: {
          queryScope: index.queryScope || 'COLLECTION',
          fields,
        },
      });
      console.log(
        `  ⏳ Index lancé pour "${index.collectionGroup}" (${fields
          .map((f) => f.fieldPath)
          .join(', ')}) — opération: ${operation.name}`
      );
    } catch (error) {
      if (error.code === 6 /* ALREADY_EXISTS */) {
        console.log(`  ✓ Index déjà existant pour "${index.collectionGroup}" (${fields.map((f) => f.fieldPath).join(', ')})`);
      } else {
        console.error(`  ✗ Échec pour "${index.collectionGroup}":`, error.message);
      }
    }
  }

  console.log(
    '\n[init-firestore] Les index composites peuvent prendre plusieurs minutes à devenir "Enabled".\n' +
      'Suivez leur statut dans la console Firebase > Firestore Database > Index.\n'
  );
}

async function main() {
  const args = process.argv.slice(2);
  const skipIndexes = args.includes('--skip-indexes');
  const skipCollections = args.includes('--skip-collections');

  const serviceAccount = loadServiceAccount();

  if (!skipCollections) {
    await createCollections(serviceAccount);
  }

  if (!skipIndexes) {
    await createIndexes(serviceAccount);
  }

  console.log('[init-firestore] Terminé.\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('\n[init-firestore] Erreur fatale :', error);
  process.exit(1);
});
