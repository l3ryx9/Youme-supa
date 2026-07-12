/**
 * Écran de Téléchargement des Modèles IA
 *
 * Affiche la progression réelle synchronisée avec les événements du
 * ModelDownloadManager, y compris les états de reconnexion (retrying)
 * avec compte à rebours, pour ne jamais paraître gelé.
 */
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Button, ProgressBar } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import {
  modelDownloadManager,
  type ModelDownloadProgress,
} from '../../src/ai/models/ModelDownloadManager';
import { useYoumeColors, YoumeColors, YOUME_COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../src/shared/constants/theme';

const MODEL_LABELS: Record<ModelDownloadProgress['modelId'], string> = {
  llm: "Extraction d'informations",
  emotion: 'Analyse des émotions (français)',
  whisper: 'Transcription vocale',
};

interface RetryState {
  attempt: number;
  maxAttempts: number;
  remainingMs: number;
}

export default function DownloadModelsScreen() {
  const [progress, setProgress] = useState(0);
  const [currentLabel, setCurrentLabel] = useState('Préparation…');
  const [isDone, setIsDone] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [retryState, setRetryState] = useState<RetryState | null>(null);
  const startedRef = useRef(false);
  const colors = useYoumeColors();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const remainingSecs = retryState ? Math.ceil(retryState.remainingMs / 1000) : 0;

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const unsubscribe = modelDownloadManager.onProgress((p: ModelDownloadProgress) => {
      if (p.status === 'retrying') {
        // Mise à jour du compte à rebours — ne pas écraser la progression globale
        setRetryState({
          attempt: p.retryAttempt ?? 1,
          maxAttempts: p.retryMaxAttempts ?? 7,
          remainingMs: p.retryDelayMs ?? 0,
        });
        return;
      }
      // Status 'downloading' — reprend normalement
      setRetryState(null);
      setProgress(p.overallProgress);
      setCurrentLabel(MODEL_LABELS[p.modelId] ?? p.modelId);
    });

    modelDownloadManager
      .downloadAllModels()
      .then(() => {
        setRetryState(null);
        setIsDone(true);
      })
      .catch((error) => {
        console.error('[DownloadModelsScreen] Erreur de téléchargement :', error);
        setRetryState(null);
        setHasError(true);
      });

    return unsubscribe;
  }, []);

  const goToLogin = () => router.replace('/(auth)/login');

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Ionicons
          name={isDone ? 'checkmark-circle' : 'cloud-download-outline'}
          size={64}
          color={isDone ? colors.success : colors.primary}
        />

        <Text style={styles.title}>
          {isDone ? 'Modèles IA prêts !' : "Téléchargement de l'IA locale"}
        </Text>

        {/* Sous-titre : label courant OU état de reconnexion */}
        {!isDone && (
          <Text style={styles.subtitle}>
            {retryState
              ? `${currentLabel}…`
              : `${currentLabel}… (${Math.round(progress * 100)}%)`}
          </Text>
        )}

        {isDone && (
          <Text style={styles.subtitle}>
            Les 3 modèles d'IA sont installés sur votre appareil.{' '}
            Aucune donnée ne sera envoyée à un serveur.
          </Text>
        )}

        {/* Barre de progression */}
        {!isDone && (
          <View style={styles.progressWrapper}>
            <ProgressBar
              progress={progress}
              color={retryState ? YOUME_COLORS.warning : colors.primary}
              style={styles.progressBar}
            />
            {/* Pourcentage sous la barre */}
            <Text style={[styles.progressPct, retryState && { color: YOUME_COLORS.warning }]}>
              {Math.round(progress * 100)}%
            </Text>
          </View>
        )}

        {/* Bloc reconnexion — affiché PENDANT le délai de backoff */}
        {retryState && !isDone && (
          <View style={styles.retryBox}>
            <ActivityIndicator size="small" color={YOUME_COLORS.warning} style={{ marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.retryTitle}>
                Reconnexion en cours… (tentative {retryState.attempt}/{retryState.maxAttempts})
              </Text>
              <Text style={styles.retryCountdown}>
                Reprise dans {remainingSecs}s — les données déjà téléchargées sont conservées.
              </Text>
            </View>
          </View>
        )}

        {/* Erreur finale — seulement après épuisement des 7 tentatives */}
        {hasError && !isDone && (
          <Text style={styles.errorText}>
            Le téléchargement a échoué après plusieurs tentatives. L'application reste utilisable
            (analyses simplifiées) — vous pourrez retenter plus tard.
          </Text>
        )}

        {!retryState && !hasError && !isDone && (
          <Text style={styles.note}>
            Vous pouvez continuer sans attendre : le téléchargement se poursuit en arrière-plan.
          </Text>
        )}

        <Button
          mode="contained"
          onPress={goToLogin}
          style={styles.button}
          contentStyle={styles.buttonContent}
          buttonColor={colors.primary}
        >
          {isDone ? 'Continuer' : 'Continuer sans attendre'}
        </Button>
      </View>
    </View>
  );
}

function getStyles(colors: YoumeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
    content: { paddingHorizontal: SPACING.xl, alignItems: 'center', gap: SPACING.sm },
    title: {
      fontSize: TYPOGRAPHY.size.xl,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
      marginTop: SPACING.md,
    },
    subtitle: {
      fontSize: TYPOGRAPHY.size.md,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: SPACING.xs,
    },
    progressWrapper: { width: '100%', marginTop: SPACING.lg, gap: 6 },
    progressBar: { height: 8, borderRadius: BORDER_RADIUS.sm },
    progressPct: {
      fontSize: TYPOGRAPHY.size.xs,
      color: colors.textMuted,
      textAlign: 'right',
    },
    retryBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: 'rgba(255, 165, 0, 0.12)',
      borderRadius: BORDER_RADIUS.sm,
      borderLeftWidth: 3,
      borderLeftColor: YOUME_COLORS.warning,
      padding: SPACING.sm,
      marginTop: SPACING.md,
      width: '100%',
    },
    retryTitle: {
      fontSize: TYPOGRAPHY.size.sm,
      color: YOUME_COLORS.warning,
      fontWeight: '600',
    },
    retryCountdown: {
      fontSize: TYPOGRAPHY.size.xs,
      color: colors.textMuted,
      marginTop: 2,
    },
    errorText: {
      fontSize: TYPOGRAPHY.size.sm,
      color: YOUME_COLORS.warning,
      textAlign: 'center',
      marginTop: SPACING.md,
    },
    note: {
      fontSize: TYPOGRAPHY.size.xs,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: SPACING.lg,
    },
    button: { marginTop: SPACING.xl, borderRadius: BORDER_RADIUS.md, width: '100%' },
    buttonContent: { height: 50 },
    debugLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      marginTop: SPACING.md,
    },
    debugLinkText: { color: colors.textMuted, fontSize: TYPOGRAPHY.size.xs },
  });
}
