/**
 * Écran Analyse de conversation
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useYoumeColors, YoumeColors, YOUME_COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../../src/shared/constants/theme';
import { useAuthStore } from '../../../src/presentation/stores/authStore';
import { useConversationStore } from '../../../src/presentation/stores/conversationStore';
import { llmService } from '../../../src/ai/llm/LLMService';
import {
  analyzeConversation,
  analyzeConflict,
  type AnalysisResult,
} from '../../../src/ai/analysis/ConversationAnalysisService';

function ScoreBar({ label, value, color, colors }: { label: string; value: number; color: string; colors: YoumeColors }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm }}>
      <Text style={{ width: 80, fontSize: TYPOGRAPHY.size.xs, color: colors.textSecondary }}>{label}</Text>
      <View style={{ flex: 1, height: 6, backgroundColor: colors.surfaceVariant, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: '100%', borderRadius: 3, width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />
      </View>
      <Text style={{ width: 28, fontSize: TYPOGRAPHY.size.xs, textAlign: 'right', color: colors.textPrimary }}>{value}</Text>
    </View>
  );
}

function FlagCard({
  type,
  texte,
  severite,
  contexte,
  colors,
}: {
  type: 'red' | 'green';
  texte: string;
  severite?: string;
  contexte: string;
  colors: YoumeColors;
}) {
  const color = type === 'red' ? colors.error : colors.success;
  const icon = type === 'red' ? 'alert-circle' : 'checkmark-circle';
  return (
    <View style={[{ flexDirection: 'row', gap: SPACING.sm, backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, marginBottom: SPACING.xs, borderWidth: 1, alignItems: 'flex-start', borderColor: `${color}44` }]}>
      <Ionicons name={icon as any} size={18} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: TYPOGRAPHY.size.md, fontWeight: '600', color }}>
          {texte}
          {severite ? <Text style={{ fontSize: TYPOGRAPHY.size.xs, fontWeight: '400', color: colors.textMuted }}> · {severite}</Text> : null}
        </Text>
        <Text style={{ fontSize: TYPOGRAPHY.size.xs, color: colors.textSecondary, marginTop: 2 }}>{contexte}</Text>
      </View>
    </View>
  );
}

export default function ConversationAnalysisScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const { messages, conversations } = useConversationStore();
  const colors = useYoumeColors();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [advice, setAdvice] = useState<string | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [loadingAdvice, setLoadingAdvice] = useState(false);

  const conversationMessages = useMemo(
    () => (messages[conversationId ?? ''] ?? []).filter((m) => !m.isDeleted && m.content.trim()),
    [messages, conversationId]
  );

  const partner = useMemo(
    () => conversations.find((c) => c.id === conversationId),
    [conversations, conversationId]
  );

  const modelReady = llmService.isAvailable();

  const handleAnalyze = useCallback(async () => {
    if (!user || conversationMessages.length === 0) return;
    setLoadingAnalysis(true);
    setAdvice(null);
    try {
      const analysisInput = conversationMessages.map((m) => ({ content: m.content, senderId: m.senderId }));
      const result = await analyzeConversation(analysisInput, user.id);
      setAnalysis(result);
    } finally {
      setLoadingAnalysis(false);
    }
  }, [user, conversationMessages]);

  const handleAdvice = useCallback(async () => {
    if (!user || conversationMessages.length === 0) return;
    setLoadingAdvice(true);
    try {
      const analysisInput = conversationMessages.map((m) => ({ content: m.content, senderId: m.senderId }));
      const result = await analyzeConflict(analysisInput, user.id);
      setAdvice(result);
    } finally {
      setLoadingAdvice(false);
    }
  }, [user, conversationMessages]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Ionicons name="heart-half" size={18} color={colors.primary} />
        <Text style={styles.headerTitle}>Analyse de la relation</Text>
      </View>

      {partner && (
        <Text style={styles.partnerLine}>Avec {partner.partnerDisplayName}</Text>
      )}

      <View style={styles.disclaimer}>
        <Ionicons name="information-circle-outline" size={16} color={YOUME_COLORS.warning} />
        <Text style={styles.disclaimerText}>
          Analyse indicative et probabiliste — ne remplace pas un accompagnement professionnel.
        </Text>
      </View>

      {conversationMessages.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={56} color={colors.textMuted} />
          <Text style={styles.emptyText}>Pas encore de messages à analyser dans cette conversation.</Text>
        </View>
      ) : (
        <>
          <TouchableOpacity
            style={[styles.analyzeBtn, loadingAnalysis && styles.btnDisabled]}
            onPress={handleAnalyze}
            disabled={loadingAnalysis}
          >
            {loadingAnalysis ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Ionicons name="pulse" size={18} color="#FFFFFF" />
                <Text style={styles.analyzeBtnText}>Analyser notre conversation</Text>
              </>
            )}
          </TouchableOpacity>

          {analysis && (
            <>
              <Text style={styles.modelNote}>
                {analysis.isAI ? 'Analyse par IA locale (Qwen 0.5B)' : 'Analyse par règles — modèle IA non chargé'}
              </Text>

              <View style={styles.scoreCard}>
                <Text style={styles.scoreGlobal}>{analysis.scores.global}</Text>
                <Text style={styles.scoreGlobalLabel}>/100</Text>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Sous-scores</Text>
                <ScoreBar label="Respect" value={analysis.scores.respect} color={colors.primary} colors={colors} />
                <ScoreBar label="Empathie" value={analysis.scores.empathie} color={colors.primary} colors={colors} />
                <ScoreBar label="Honnêteté" value={analysis.scores.honnetete} color={colors.primary} colors={colors} />
                <ScoreBar label="Limites" value={analysis.scores.limites} color={colors.primary} colors={colors} />
                <ScoreBar label="Positivité" value={analysis.scores.positivite} color={colors.success} colors={colors} />
              </View>

              {analysis.redFlags.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>🚩 Points d'attention</Text>
                  {analysis.redFlags.map((f, i) => (
                    <FlagCard key={i} type="red" texte={f.texte} severite={f.severite} contexte={f.contexte} colors={colors} />
                  ))}
                </View>
              )}

              {analysis.greenFlags.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>💚 Points positifs</Text>
                  {analysis.greenFlags.map((f, i) => (
                    <FlagCard key={i} type="green" texte={f.texte} contexte={f.contexte} colors={colors} />
                  ))}
                </View>
              )}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📝 Résumé</Text>
                <Text style={styles.resume}>{analysis.resume}</Text>
              </View>

              <TouchableOpacity
                style={[styles.adviceBtn, loadingAdvice && styles.btnDisabled]}
                onPress={handleAdvice}
                disabled={loadingAdvice || !modelReady}
              >
                {loadingAdvice ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <>
                    <Ionicons name="bulb-outline" size={18} color={colors.primary} />
                    <Text style={styles.adviceBtnText}>
                      {modelReady ? 'Obtenir des conseils' : 'Conseils indisponibles (modèle IA non chargé)'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {advice && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>💬 Conseils</Text>
                  <Text style={styles.resume}>{advice}</Text>
                </View>
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function getStyles(colors: YoumeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingBottom: 40 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
      paddingTop: 48,
      paddingBottom: SPACING.sm,
      paddingHorizontal: SPACING.md,
      backgroundColor: colors.secondary,
    },
    headerTitle: { fontSize: TYPOGRAPHY.size.xl, fontWeight: '700', color: colors.textPrimary },
    partnerLine: { fontSize: TYPOGRAPHY.size.sm, color: colors.textSecondary, paddingHorizontal: SPACING.md, marginTop: SPACING.sm },
    disclaimer: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: SPACING.xs,
      margin: SPACING.md,
      backgroundColor: `${YOUME_COLORS.warning}22`,
      borderRadius: BORDER_RADIUS.md,
      padding: SPACING.sm,
      borderWidth: 1,
      borderColor: `${YOUME_COLORS.warning}44`,
    },
    disclaimerText: { flex: 1, fontSize: TYPOGRAPHY.size.xs, color: YOUME_COLORS.warning, lineHeight: 18 },
    empty: { alignItems: 'center', justifyContent: 'center', gap: SPACING.md, padding: SPACING.xl },
    emptyText: { fontSize: TYPOGRAPHY.size.md, color: colors.textSecondary, textAlign: 'center' },
    analyzeBtn: {
      flexDirection: 'row',
      backgroundColor: colors.primary,
      borderRadius: BORDER_RADIUS.lg,
      height: 52,
      marginHorizontal: SPACING.md,
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.xs,
      marginBottom: SPACING.md,
    },
    btnDisabled: { opacity: 0.6 },
    analyzeBtnText: { color: '#FFFFFF', fontSize: TYPOGRAPHY.size.lg, fontWeight: '700' },
    modelNote: { textAlign: 'center', fontSize: TYPOGRAPHY.size.xs, color: colors.textMuted, marginBottom: SPACING.sm },
    scoreCard: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 4, marginBottom: SPACING.lg },
    scoreGlobal: { fontSize: 64, fontWeight: '800', color: colors.primary, lineHeight: 70 },
    scoreGlobalLabel: { fontSize: TYPOGRAPHY.size.xxl, color: colors.textMuted, marginBottom: SPACING.sm },
    section: { marginHorizontal: SPACING.md, marginBottom: SPACING.md },
    sectionTitle: { fontSize: TYPOGRAPHY.size.sm, fontWeight: '700', color: colors.textSecondary, marginBottom: SPACING.sm },
    resume: {
      fontSize: TYPOGRAPHY.size.md,
      color: colors.textPrimary,
      lineHeight: 22,
      backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.lg,
      padding: SPACING.md,
    },
    adviceBtn: {
      flexDirection: 'row',
      backgroundColor: `${colors.primary}22`,
      borderRadius: BORDER_RADIUS.lg,
      height: 48,
      marginHorizontal: SPACING.md,
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.xs,
      marginBottom: SPACING.md,
      borderWidth: 1,
      borderColor: `${colors.primary}44`,
    },
    adviceBtnText: { color: colors.primary, fontSize: TYPOGRAPHY.size.md, fontWeight: '600' },
  });
}
