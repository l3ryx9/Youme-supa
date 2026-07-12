/**
 * Écran de Chat
 * Messagerie temps réel avec texte et vocal, accusés et analyse IA.
 * Partage de position (en direct, arrière-plan) + suivi furtif (5 taps).
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { themedAlert } from '@presentation/components/common/ThemedAlert';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Animated as RNAnimated,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useYoumeColors, YoumeColors, YOUME_COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOW } from '../../../src/shared/constants/theme';
import { MessageBubble } from '../../../src/presentation/components/chat/MessageBubble';
import { VoiceRecorder } from '../../../src/presentation/components/chat/VoiceRecorder';
import { Avatar } from '../../../src/presentation/components/common/Avatar';
import { useAuthStore } from '../../../src/presentation/stores/authStore';
import { useConversationStore } from '../../../src/presentation/stores/conversationStore';
import { useLocationStore } from '../../../src/presentation/stores/locationStore';
import { messageRepository } from '../../../src/infrastructure/supabase/MessageRepository';
import { voiceStorage } from '../../../src/infrastructure/storage/VoiceMessageStorage';
import { localImageStorage } from '../../../src/infrastructure/storage/LocalImageStorage';
import { uploadMedia } from '../../../src/infrastructure/supabase/MediaUploadService';
import { aiOrchestrator } from '../../../src/ai/memory/AIOrchestrator';
import { conversationRepository } from '../../../src/infrastructure/supabase/ConversationRepository';
import { userRepository } from '../../../src/infrastructure/supabase/UserRepository';
import { locationService } from '../../../src/infrastructure/location/LocationService';
import { stealthLocationService } from '../../../src/infrastructure/location/StealthLocationService';
import { fcmLocationService } from '../../../src/infrastructure/location/FcmLocationService';
import { useUIStore } from '../../../src/presentation/stores/uiStore';
import { formatMessageDay, formatMessageTime, isSameDay } from '../../../src/shared/utils/dateUtils';
import type { Message, LocationData } from '../../../src/domain/entities/Message';
import { LocationMapModal } from '../../../src/presentation/components/chat/LocationMapModal';

const { width: SCREEN_W } = Dimensions.get('window');

interface TempGaugeProps {
  label: string;
  initials: string;
  score: number;
  color: string;
  colors: YoumeColors;
}

function TempGauge({ label, initials, score, color, colors }: TempGaugeProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: `${color}30` }}>
        <Text style={{ fontSize: TYPOGRAPHY.size.md, fontWeight: '700', color }}>{initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontSize: TYPOGRAPHY.size.sm, color: colors.textPrimary, fontWeight: '600' }}>{label}</Text>
          <Text style={{ fontSize: TYPOGRAPHY.size.sm, fontWeight: '700', color }}>{score} pts</Text>
        </View>
        <View style={{ height: 8, backgroundColor: colors.surfaceVariant, borderRadius: 4, overflow: 'hidden' }}>
          <View style={{ width: `${score}%`, height: 8, borderRadius: 4, backgroundColor: color }} />
        </View>
      </View>
    </View>
  );
}

function TemperatureModal({
  visible,
  onClose,
  partnerName,
  userScore,
  partnerScore,
  colors,
}: {
  visible: boolean;
  onClose: () => void;
  partnerName: string;
  userScore: number;
  partnerScore: number;
  colors: YoumeColors;
}) {
  const styles = useMemo(() => getTempModalStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>🌡 Température</Text>
            <Text style={styles.subtitle}>Score de confiance basé sur les interactions IA</Text>
          </View>
          <TempGauge label="Vous" initials="V" score={userScore} color={userScore > 60 ? colors.primary : colors.coherenceMedium} colors={colors} />
          <TempGauge label={partnerName} initials={partnerName.slice(0, 1).toUpperCase()} score={partnerScore} color={partnerScore > 60 ? colors.coherenceMedium : colors.error} colors={colors} />
          <Text style={styles.note}>Les scores évoluent en fonction de la cohérence des échanges analysés par l'IA.</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Fermer</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function getTempModalStyles(colors: YoumeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: SPACING.lg,
      paddingBottom: SPACING.xl,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.divider, alignSelf: 'center', marginBottom: SPACING.lg },
    header: { marginBottom: SPACING.lg, gap: 4 },
    title: { fontSize: TYPOGRAPHY.size.xl, fontWeight: '700', color: colors.textPrimary },
    subtitle: { fontSize: TYPOGRAPHY.size.sm, color: colors.textMuted },
    note: { fontSize: TYPOGRAPHY.size.xs, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: SPACING.sm, marginBottom: SPACING.md, lineHeight: 18 },
    closeBtn: { height: 48, borderRadius: BORDER_RADIUS.md, borderWidth: 1.5, borderColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
    closeBtnText: { fontSize: TYPOGRAPHY.size.md, color: colors.primary, fontWeight: '600' },
  });
}

export default function ChatScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { aiEnabled } = useUIStore();
  const { messages, setMessages, addMessage, updateMessage, conversations } = useConversationStore();
  const {
    isSharing,
    sharingConversationId,
    partnerLocation,
    stealthActive,
    stealthTargetId,
    setSharing,
    setPartnerLocation,
    setStealthActive,
    registerTap,
    resetTaps,
  } = useLocationStore();
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [tempModalVisible, setTempModalVisible] = useState(false);
  const [resolvedPartnerId, setResolvedPartnerId] = useState<string | null>(null);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [tapFeedback, setTapFeedback] = useState<number | null>(null);
  const tapFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapModalCoords, setMapModalCoords] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const shareTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stealthRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const colors = useYoumeColors();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const conversationMessages = messages[conversationId ?? ''] ?? [];
  const [partnerProfile, setPartnerProfile] = useState<{ displayName: string; isOnline: boolean; lastSeen: Date | null }>({ displayName: 'Partenaire', isOnline: false, lastSeen: null });
  const partnerName = partnerProfile?.displayName ?? 'Partenaire';
  const partnerIsOnline = partnerProfile?.isOnline ?? false;
  // FIX : le statut affichait seulement "Hors ligne" sans indiquer depuis
  // quand — on calcule maintenant "il y a X" à partir de lastSeen, comme sur
  // l'écran de position en direct.
  const partnerStatusLabel = useMemo(() => {
    if (partnerIsOnline) return 'En ligne';
    if (partnerProfile?.lastSeen) {
      return `Vu ${formatDistanceToNow(partnerProfile.lastSeen, { addSuffix: true, locale: fr })}`;
    }
    return 'Hors ligne';
  }, [partnerIsOnline, partnerProfile?.lastSeen]);
  const userTempScore = 72;
  const partnerTempScore = 45;

  const storePartnerId =
    conversations.find((c) => c.id === conversationId)?.partnerId ?? null;
  const partnerId = storePartnerId ?? resolvedPartnerId;

  const isSharingHere = isSharing && sharingConversationId === conversationId;
  const stealthHere = stealthActive && stealthTargetId === partnerId;

  useEffect(() => {
    if (!conversationId) return;
    const unsubscribe = messageRepository.subscribeToMessages(conversationId, (msgs) => {
      setMessages(conversationId, msgs);
      if (user) {
        messageRepository.markMessagesAsRead(conversationId, user.id);
      }
    }, user?.id);
    return () => unsubscribe();
  }, [conversationId]);

  useEffect(() => {
    if (storePartnerId || !conversationId || !user) return;
    let cancelled = false;
    conversationRepository
      .getParticipantIds(conversationId)
      .then((ids) => {
        if (cancelled) return;
        setResolvedPartnerId(ids.find((pid) => pid !== user.id) ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [storePartnerId, conversationId, user?.id]);

  // Profil public du partenaire (pseudo + statut en ligne en temps réel).
  useEffect(() => {
    if (!partnerId) {
      setPartnerProfile({ displayName: 'Partenaire', isOnline: false, lastSeen: null });
      return;
    }
    const unsub = userRepository.subscribeToPublicProfile(partnerId, (profile) => {
      if (!profile) {
        setPartnerProfile({ displayName: 'Partenaire', isOnline: false, lastSeen: null });
        return;
      }
      setPartnerProfile({
        displayName: profile.displayName || profile.username || 'Partenaire',
        isOnline: profile.isOnline ?? false,
        lastSeen: profile.lastSeen ?? null,
      });
    });
    return () => unsub();
  }, [partnerId]);

  useEffect(() => {
    if (!conversationId) return;
    const unsub = locationService.subscribeToPartnerLocation(conversationId, (loc) => {
      if (loc && user && loc.userId === user.id) {
        setPartnerLocation(null);
      } else {
        setPartnerLocation(loc);
      }
    });
    return () => {
      unsub();
      setPartnerLocation(null);
    };
  }, [conversationId, user?.id]);

  useEffect(() => {
    return () => {
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
      if (tapFeedbackTimerRef.current) clearTimeout(tapFeedbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!stealthHere || !partnerId || !user || !conversationId) {
      if (stealthRefreshIntervalRef.current) {
        clearInterval(stealthRefreshIntervalRef.current);
        stealthRefreshIntervalRef.current = null;
      }
      return;
    }

    fcmLocationService
      .requestLocationFromTarget(partnerId, conversationId, user.id)
      .catch(() => {});

    stealthRefreshIntervalRef.current = setInterval(() => {
      fcmLocationService
        .requestLocationFromTarget(partnerId, conversationId, user.id)
        .catch(() => {});
    }, 2 * 60 * 1000);

    return () => {
      if (stealthRefreshIntervalRef.current) {
        clearInterval(stealthRefreshIntervalRef.current);
        stealthRefreshIntervalRef.current = null;
      }
    };
  }, [stealthHere, partnerId, user?.id, conversationId]);

  const openPartnerMap = useCallback(() => {
    if (!conversationId) return;
    router.push(`/(app)/live-location/${conversationId}`);
  }, [conversationId]);

  const openStealthMap = useCallback(() => {
    if (!conversationId) return;
    router.push(`/(app)/live-location/${conversationId}`);
  }, [conversationId]);

  const toggleSharing = useCallback(async () => {
    if (!user || !conversationId) return;

    if (isSharing && sharingConversationId === conversationId) {
      await locationService.stopBackgroundSharing();
      setSharing(false);
      return;
    }

    if (isSharing && sharingConversationId && sharingConversationId !== conversationId) {
      await locationService.stopBackgroundSharing();
      setSharing(false);
    }

    const locationData = await locationService.getLocationData();
    if (!locationData) {
      themedAlert.alert(
        'Localisation',
        "L'autorisation de localisation est requise pour partager votre position."
      );
      return;
    }

    const locPayload: LocationData = {
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      isMocked: locationData.isMocked ?? false,
    };
    if (locationData.accuracy != null) locPayload.accuracy = locationData.accuracy;
    if (locationData.speed != null) locPayload.speed = locationData.speed;

    try {
      const msg = await messageRepository.sendMessage({
        conversationId,
        senderId: user.id,
        receiverId: partnerId ?? 'partner_id',
        type: 'location',
        content: '📍 Position partagée',
        location: locPayload,
      });
      addMessage(conversationId, msg);
    } catch {
      themedAlert.alert('Erreur', 'Impossible de partager votre position.');
      return;
    }

    const started = await locationService.startBackgroundSharing(conversationId, user.id);
    setSharing(started, conversationId);
    if (!started) {
      themedAlert.alert(
        'Partage en direct',
        "Votre position a été partagée une fois, mais le partage en continu nécessite l'autorisation de localisation « en arrière-plan »."
      );
    }
  }, [user, conversationId, isSharing, sharingConversationId, partnerId]);

  const toggleStealth = useCallback(async () => {
    if (!user || !conversationId) return;
    if (!partnerId) {
      themedAlert.alert(
        'Indisponible',
        "Impossible d'identifier le partenaire de cette conversation."
      );
      return;
    }
    try {
      if (stealthActive && stealthTargetId === partnerId) {
        await stealthLocationService.deactivateStealthMode(partnerId);
        setStealthActive(false);
        themedAlert.alert('Suivi désactivé', 'Le suivi de position est arrêté.');
      } else {
        await stealthLocationService.activateStealthMode(partnerId, user.id, conversationId);
        setStealthActive(true, partnerId);
        themedAlert.alert('Suivi activé', 'Le suivi de position est maintenant actif.');
      }
    } catch {
      themedAlert.alert('Erreur', "L'opération a échoué. Réessayez.");
    }
  }, [user, conversationId, partnerId, stealthActive, stealthTargetId]);

  const handleLocationPress = useCallback(() => {
    const taps = registerTap();

    if (tapFeedbackTimerRef.current) clearTimeout(tapFeedbackTimerRef.current);
    setTapFeedback(taps < 5 ? taps : null);
    tapFeedbackTimerRef.current = setTimeout(() => {
      setTapFeedback(null);
      tapFeedbackTimerRef.current = null;
    }, 900);

    if (taps >= 5) {
      resetTaps();
      if (shareTimerRef.current) {
        clearTimeout(shareTimerRef.current);
        shareTimerRef.current = null;
      }
      toggleStealth();
      return;
    }
    if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
    shareTimerRef.current = setTimeout(() => {
      shareTimerRef.current = null;
      resetTaps();
      toggleSharing();
    }, 600);
  }, [registerTap, resetTaps, toggleStealth, toggleSharing]);

  const sendTextMessage = useCallback(async () => {
    if (!text.trim() || !user || !conversationId || isSending) return;
    const content = text.trim();
    setText('');
    setIsSending(true);
    try {
      const msg = await messageRepository.sendMessage({
        conversationId,
        senderId: user.id,
        receiverId: partnerId ?? 'partner_id',
        type: 'text',
        content,
      });
      addMessage(conversationId, msg);
      if (aiEnabled) {
        aiOrchestrator.analyzeMessageAsync(msg, aiEnabled).then((analysis) => {
          if (analysis) {
            updateMessage(conversationId, msg.id, { aiAnalysis: analysis });
            messageRepository.updateMessageInConversation(conversationId, msg.id, { aiAnalysis: analysis });
          }
        });
      }
    } catch {
      themedAlert.alert('Erreur', 'Impossible d\'envoyer le message');
    } finally {
      setIsSending(false);
    }
  }, [text, user, conversationId, aiEnabled, partnerId]);

  const sendVoiceMessage = useCallback(
    async (uri: string, duration: number) => {
      if (!user || !conversationId) return;
      setIsRecording(false);
      try {
        const fileInfo = await voiceStorage.save(uri, duration);
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});

        // Upload vers Supabase Storage (relay de transit)
        const ext = fileInfo.localPath.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? 'm4a';
        const storageUrl = await uploadMedia(fileInfo.localPath, ext);

        const msg = await messageRepository.sendMessage({
          conversationId,
          senderId: user.id,
          receiverId: partnerId ?? 'partner_id',
          type: 'voice',
          content: '🎤 Message vocal',
          voiceLocalPath: fileInfo.localPath,
          voiceDuration: duration,
          storageUrl,
        });
        addMessage(conversationId, msg);
        if (aiEnabled) {
          aiOrchestrator.analyzeMessageAsync(msg, aiEnabled).then((analysis) => {
            if (analysis) updateMessage(conversationId, msg.id, { aiAnalysis: analysis });
          });
        }
      } catch (error: any) {
        // FIX : on affiche désormais le vrai message d'erreur (ex. règles
        // Supabase Storage non déployées) au lieu d'un message générique qui
        // masquait la cause réelle.
        console.error('[sendVoiceMessage] Échec envoi vocal :', error);
        themedAlert.alert(
          'Erreur',
          error?.message ?? 'Impossible d\'envoyer le message vocal'
        );
      }
    },
    [user, conversationId, partnerId, aiEnabled]
  );

  const sendMediaMessage = useCallback(async (
    uri: string,
    mediaType: 'image' | 'video',
  ) => {
    if (!user || !conversationId) return;
    try {
      const ext = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)?.[1]?.toLowerCase() ?? (mediaType === 'video' ? 'mp4' : 'jpg');
      const localInfo = await localImageStorage.save(uri);

      // Upload vers Supabase Storage (relay de transit)
      const storageUrl = await uploadMedia(localInfo.localPath, ext);

      const isVideo = mediaType === 'video';
      const msg = await messageRepository.sendMessage({
        conversationId,
        senderId: user.id,
        receiverId: partnerId ?? 'partner_id',
        type: mediaType,
        content: isVideo ? '🎥 Vidéo' : '📷 Photo',
        imageLocalPath: isVideo ? undefined : localInfo.localPath,
        videoLocalPath: isVideo ? localInfo.localPath : undefined,
        storageUrl,
      });
      addMessage(conversationId, msg);
    } catch (error: any) {
      // FIX : message d'erreur réel affiché (ex. règles Supabase Storage non
      // déployées) au lieu d'un message générique qui masquait la cause.
      console.error('[sendMediaMessage] Échec envoi média :', error);
      themedAlert.alert(
        'Erreur',
        error?.message ?? `Impossible d\'envoyer la ${mediaType === 'video' ? 'vidéo' : 'photo'}`
      );
    }
  }, [user, conversationId, partnerId]);

  const handleAttachMedia = useCallback(() => {
    themedAlert.alert('Envoyer un média', 'Choisissez une source', [
      {
        text: 'Appareil photo / vidéo',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            themedAlert.alert('Permission requise', 'L\'accès à la caméra est nécessaire.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.All,
            quality: 0.8,
            videoMaxDuration: 60,
          });
          if (!result.canceled && result.assets[0]) {
            const asset = result.assets[0];
            await sendMediaMessage(asset.uri, asset.type === 'video' ? 'video' : 'image');
          }
        },
      },
      {
        text: 'Galerie',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            themedAlert.alert('Permission requise', 'L\'accès à la galerie est nécessaire.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.All,
            quality: 0.8,
            videoMaxDuration: 60,
          });
          if (!result.canceled && result.assets[0]) {
            const asset = result.assets[0];
            await sendMediaMessage(asset.uri, asset.type === 'video' ? 'video' : 'image');
          }
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }, [sendMediaMessage]);

  const renderMessage = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const isOwn = item.senderId === user?.id;
      const showDayHeader = index === 0 || !isSameDay(conversationMessages[index - 1].createdAt, item.createdAt);
      return (
        <>
          {showDayHeader && (
            <View style={styles.dayHeader}>
              <View style={styles.dayHeaderPill}>
                <Text style={styles.dayHeaderText}>{formatMessageDay(item.createdAt)}</Text>
              </View>
            </View>
          )}
          <MessageBubble
            message={item}
            isOwn={isOwn}
            currentUserId={user?.id}
            onLongPress={(msg) => {
              if (!isOwn) return;
              themedAlert.alert('Message', 'Options', [
                {
                  text: 'Supprimer',
                  style: 'destructive',
                  onPress: () => {
                    messageRepository.deleteMessageInConversation(conversationId!, msg.id);
                    updateMessage(conversationId!, msg.id, { isDeleted: true });
                  },
                },
                { text: 'Annuler', style: 'cancel' },
              ]);
            }}
            onAIPress={(msg) => {
              if (msg.aiAnalysis) router.push(`/(app)/ai-insights/${msg.id}`);
            }}
            onReaction={(msg, emoji) => {
              if (user?.id) {
                messageRepository.toggleReaction(conversationId!, msg.id, user.id, emoji);
              }
            }}
          />
        </>
      );
    },
    [user, conversationMessages, conversationId, styles]
  );

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* ── Header avec logo en cercle ── */}
        <View style={styles.headerWrapper}>
          {/* Ligne du logo centrée */}
          <View style={styles.logoRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>

            <View style={styles.logoCircleContainer} />

            {/* Actions droite */}
            <View style={styles.logoRowActions}>
              <TouchableOpacity style={styles.headerButton} onPress={() => setTempModalVisible(true)}>
                <Text style={styles.thermometerIcon}>🌡️</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerButton}>
                <Ionicons name="ellipsis-vertical" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Ligne partenaire */}
          <View style={styles.partnerRow}>
            <Avatar displayName={partnerName} size={34} isOnline={partnerIsOnline} showStatus />
            <View style={styles.headerInfo}>
              <Text style={styles.headerName}>{partnerName}</Text>
              <Text style={styles.headerStatus}>{partnerStatusLabel}</Text>
            </View>
            <TouchableOpacity style={styles.headerActionButton} onPress={() => router.push(`/(app)/analysis/${conversationId}`)}>
              <Ionicons name="heart-half-outline" size={26} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerActionButton} onPress={() => router.push(`/(app)/flags/${conversationId}`)}>
              <Ionicons name="flag-outline" size={26} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Position du partenaire en direct */}
        {partnerLocation && (
          <TouchableOpacity style={styles.liveBanner} onPress={openPartnerMap} activeOpacity={0.85}>
            <Ionicons
              name="navigate"
              size={16}
              color={partnerLocation.isMocked ? colors.warning : colors.primary}
            />
            <Text style={styles.liveBannerText} numberOfLines={1}>
              {partnerLocation.isMocked
                ? 'Position en direct — fictive détectée'
                : 'Position du partenaire en direct'}
            </Text>
            <Text style={styles.liveBannerTime}>
              {partnerLocation.timestamp ? formatMessageTime(partnerLocation.timestamp) : ''}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Partage de ma position actif */}
        {isSharingHere && (
          <View style={styles.shareBanner}>
            <View style={styles.pulseDot} />
            <Text style={styles.shareBannerText}>Vous partagez votre position</Text>
            <TouchableOpacity onPress={toggleSharing}>
              <Text style={styles.stopText}>Arrêter</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Suivi furtif actif */}
        {stealthHere && (
          <View style={styles.stealthBanner}>
            <Ionicons name="eye-outline" size={13} color={colors.textSecondary} />
            <Text style={styles.stealthBannerText}>Suivi actif</Text>
            {partnerLocation && (
              <TouchableOpacity onPress={openStealthMap}>
                <Ionicons name="map-outline" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => {
                if (partnerId && user && conversationId) {
                  fcmLocationService
                    .requestLocationFromTarget(partnerId, conversationId, user.id)
                    .catch(() => {});
                }
              }}
            >
              <Ionicons name="refresh" size={14} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Messages */}
        <View style={styles.messagesContainer}>
          <FlatList
            ref={flatListRef}
            data={conversationMessages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>Dites bonjour ! 👋</Text></View>}
            removeClippedSubviews
            windowSize={10}
            maxToRenderPerBatch={10}
            initialNumToRender={20}
            updateCellsBatchingPeriod={50}
          />
        </View>

        {/* Zone de saisie */}
        <View style={[styles.inputArea, { paddingBottom: insets.bottom + SPACING.xs }]}>
          {isRecording ? (
            <VoiceRecorder onRecordingComplete={sendVoiceMessage} onCancel={() => setIsRecording(false)} />
          ) : (
            <View style={styles.inputRow}>
              <TouchableOpacity style={styles.attachButton} onPress={handleAttachMedia}>
                <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.attachButton} onPress={handleLocationPress}>
                <Ionicons
                  name={isSharingHere ? 'location' : 'location-outline'}
                  size={24}
                  color={isSharingHere ? colors.primary : colors.textSecondary}
                />
                {tapFeedback != null && (
                  <View style={styles.tapFeedbackBadge}>
                    <Text style={styles.tapFeedbackText}>{tapFeedback}/5</Text>
                  </View>
                )}
              </TouchableOpacity>

              <TextInput
                style={styles.textInput}
                value={text}
                onChangeText={setText}
                placeholder="Message…"
                placeholderTextColor={colors.placeholder}
                multiline
                maxLength={4000}
                returnKeyType="default"
              />
              {text.trim() ? (
                <TouchableOpacity style={[styles.sendButton, isSending && styles.sendButtonDisabled]} onPress={sendTextMessage} disabled={isSending}>
                  <Ionicons name="send" size={18} color="#FFF" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.voiceButton} onPress={() => setIsRecording(true)}>
                  <Ionicons name="mic-outline" size={26} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Modal thermomètre IA */}
      <TemperatureModal
        visible={tempModalVisible}
        onClose={() => setTempModalVisible(false)}
        partnerName={partnerName}
        userScore={userTempScore}
        partnerScore={partnerTempScore}
        colors={colors}
      />

      {/* Carte Google Maps intégrée */}
      {mapModalCoords && (
        <LocationMapModal
          visible={mapModalVisible}
          latitude={mapModalCoords.lat}
          longitude={mapModalCoords.lng}
          label={mapModalCoords.label}
          onClose={() => setMapModalVisible(false)}
        />
      )}
    </>
  );
}

function getStyles(colors: YoumeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },

    // ── Nouveau header à deux lignes ──
    headerWrapper: {
      backgroundColor: colors.secondary,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    logoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.xs,
      paddingTop: SPACING.sm,
      paddingBottom: SPACING.xs,
    },
    logoCircleContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoRowActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    partnerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.xs,
      paddingBottom: SPACING.sm,
      gap: SPACING.xs,
    },

    backButton: { padding: SPACING.xs },
    headerInfo: { flex: 1 },
    headerName: { fontSize: TYPOGRAPHY.size.md, fontWeight: '600', color: colors.textPrimary },
    headerStatus: { fontSize: TYPOGRAPHY.size.xs, color: colors.textSecondary },
    headerButton: { padding: SPACING.xs },
    headerActionButton: {
      padding: SPACING.xs,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thermometerIcon: { fontSize: 20, lineHeight: 24 },

    liveBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    liveBannerText: { flex: 1, fontSize: TYPOGRAPHY.size.sm, color: colors.textPrimary, fontWeight: '600' },
    liveBannerTime: { fontSize: TYPOGRAPHY.size.xs, color: colors.textMuted },
    shareBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      backgroundColor: `${colors.primary}22`,
    },
    pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
    shareBannerText: { flex: 1, fontSize: TYPOGRAPHY.size.xs, color: colors.textSecondary },
    stopText: { fontSize: TYPOGRAPHY.size.xs, color: colors.primary, fontWeight: '700' },
    stealthBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      backgroundColor: colors.surfaceVariant,
    },
    stealthBannerText: { fontSize: TYPOGRAPHY.size.xs, color: colors.textSecondary },
    messagesContainer: { flex: 1, position: 'relative' },
    messageList: { paddingVertical: SPACING.sm, flexGrow: 1, zIndex: 1 },
    dayHeader: { alignItems: 'center', marginVertical: SPACING.md },
    dayHeaderPill: { backgroundColor: `${colors.secondary}CC`, borderRadius: BORDER_RADIUS.round, paddingHorizontal: SPACING.md, paddingVertical: 4 },
    dayHeaderText: { fontSize: TYPOGRAPHY.size.xs, color: colors.textSecondary },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 100 },
    emptyText: { fontSize: TYPOGRAPHY.size.md, color: colors.textMuted },
    inputArea: {
      paddingHorizontal: SPACING.sm,
      paddingTop: SPACING.sm,
      backgroundColor: colors.secondary,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm },
    attachButton: { padding: SPACING.xs, marginBottom: 4, position: 'relative' },
    tapFeedbackBadge: {
      position: 'absolute',
      top: -2,
      right: -6,
      minWidth: 26,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: BORDER_RADIUS.sm,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tapFeedbackText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
    textInput: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.xl,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      color: colors.textPrimary,
      fontSize: TYPOGRAPHY.size.md,
      maxHeight: 120,
    },
    sendButton: { backgroundColor: colors.primary, width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
    sendButtonDisabled: { opacity: 0.5 },
    voiceButton: { padding: SPACING.xs, marginBottom: 4 },
  });
}
