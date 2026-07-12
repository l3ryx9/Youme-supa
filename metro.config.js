// Config Metro personnalisée : on repart de la config Expo par défaut et on
// remplace uniquement le minifieur, pour pouvoir obfusquer en plus les
// modules sensibles (chiffrement E2E) avant que Hermes ne compile le bundle.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer.minifierPath = require.resolve('./scripts/metro-obfuscator-minifier.js');

module.exports = config;
