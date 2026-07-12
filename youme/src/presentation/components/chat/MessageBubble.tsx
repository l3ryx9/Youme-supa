/**
 * Composant Bulle de Message
 * Affiche texte, vocal, image, vidéo ou localisation.
 * Les médias (vocal/image/vidéo) sont résolus localement ou téléchargés
 * depuis Firebase Storage (relay de transit).
 * Supporte les réactions emoji (appui long → picker).
 */
import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useYoumeColors, YoumeColors, SPACING, BORDER_RADIUS, TYPOGRAPHY } from '@shared/constants/theme';
import { formatMessageTimestamp } from '@shared/utils/dateUtils';
import type { Message } from '@domain/entities/Message';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';
import { LocationBubble } from './LocationBubble';
import { EmotionBadge } from '../ai/EmotionBadge';
import { useMediaPath } from '@presentation/hooks/useMediaPath';

const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍'];

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  currentUserId?: string;
  onLongPress?: (message: Message) => void;
  onAIPress?: (message: Message) => void;
  onReaction?: (message: Message, emoji: string) => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─── Bulle image ─────────────────────────────────────────────────────────────

function ImageBubble({
  message,
  isOwn,
}: {
  message: Message;
  isOwn: boolean;
}) {
  const colors = useYoumeColors();
  const { effectivePath, isDownloading, unavailable } = useMediaPath({
    localPath: message.imageLocalPath,
    storageUrl: message.storageUrl,
    messageId: message.id,
    ext: 'jpg',
    conversationId: message.conversationId,
    isReceiver: !isOwn,
  });

  if (isDownloading) return (
    <View style={mediaSt.placeholder}>
      <ActivityIndicator size="small" color={isOwn ? '#B2DFD4' : colors.primary} />
    </View>
  );

  if (unavailable || !effectivePath) return (
    <View style={mediaSt.unavailable}>
      <Ionicons name="image-outline" size={18} color={colors.textMuted} />
      <Text style={[mediaSt.unavailableText, { color: colors.textMuted }]}>Photo non disponible</Text>
    </View>
  );

  return (
    <Image source={{ uri: effectivePath }} style={mediaSt.image} resizeMode="cover" />
  );
}

// ─── Bulle vidéo ─────────────────────────────────────────────────────────────

function VideoBubble({
  message,
  isOwn,
}: {
  message: Message;
  isOwn: boolean;
}) {
  const colors = useYoumeColors();
  const ext = message.videoLocalPath?.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? 'mp4';
  const { effectivePath, isDownloading, unavailable } = useMediaPath({
    localPath: message.videoLocalPath,
    storageUrl: message.storageUrl,
    messageId: message.id,
    ext,
    conversationId: message.conversationId,
    isReceiver: !isOwn,
  });

  if (isDownloading) return (
    <View style={mediaSt.placeholder}>
      <ActivityIndicator size="small" color={isOwn ? '#B2DFD4' : colors.primary} />
    </View>
  );

  if (unavailable || !effectivePath) return (
    <View style={mediaSt.unavailable}>
      <Ionicons name="videocam-outline" size={18} color={colors.textMuted} />
      <Text style={[mediaSt.unavailableText, { color: colors.textMuted }]}>Vidéo non disponible</Text>
    </View>
  );

  return (
    <Video
      source={{ uri: effectivePath }}
      style={mediaSt.video}
      useNativeControls
      resizeMode={ResizeMode.CONTAIN}
      isLooping={false}
    />
  );
}

const mediaSt = StyleSheet.create({
  image: { width: 220, height: 220, borderRadius: BORDER_RADIUS.md },
  video: { width: 220, height: 160, borderRadius: BORDER_RADIUS.md },
  placeholder: { width: 220, height: 180, borderRadius: BORDER_RADIUS.md, justifyContent: 'center', alignItems: 'center', backgroundColor: '#00000015' },
  unavailable: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  unavailableText: { fontSize: TYPOGRAPHY.size.sm, fontStyle: 'italic' },
});

// ─── Picker emoji ─────────────────────────────────────────────────────────────

function EmojiPicker({
  visible,
  onSelect,
  onClose,
  currentEmoji,
}: {
  visible: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  currentEmoji?: string;
}) {
  const colors = useYoumeColors();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={pickerSt.overlay} onPress={onClose}>
        <View style={[pickerSt.picker, { backgroundColor: colors.surface, shadowColor: colors.textPrimary }]}>
          {REACTION_EMOJIS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={[pickerSt.emojiBtn, currentEmoji === emoji && { backgroundColor: colors.primary + '30' }]}
              onPress={() => { onSelect(emoji); onClose(); }}
            >
              <Text style={pickerSt.emoji}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const pickerSt = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#00000040' },
  picker: {
    flexDirection: 'row',
    borderRadius: 32,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 4,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  emojiBtn: { padding: 8, borderRadius: 24 },
  emoji: { fontSize: 26 },
});

// ─── Affichage groupé des réactions ──────────────────────────────────────────

function ReactionRow({
  reactions,
  currentUserId,
  isOwn,
  onPress,
}: {
  reactions: Record<string, string>;
  currentUserId?: string;
  isOwn: boolean;
  onPress: (emoji: string) => void;
}) {
  const colors = useYoumeColors();
  const grouped: Record<string, { count: number; mine: boolean }> = {};
  for (const [uid, emoji] of Object.entries(reactions)) {
    if (!grouped[emoji]) grouped[emoji] = { count: 0, mine: false };
    grouped[emoji].count++;
    if (uid === currentUserId) grouped[emoji].mine = true;
  }
  const entries = Object.entries(grouped);
  if (entries.length === 0) return null;

  return (
    <View style={[reactionSt.row, isOwn ? reactionSt.rowOwn : reactionSt.rowOther]}>
      {entries.map(([emoji, { count, mine }]) => (
        <TouchableOpacity
          key={emoji}
          style={[
            reactionSt.chip,
            { backgroundColor: mine ? colors.primary + '25' : colors.surface },
            mine && { borderColor: colors.primary, borderWidth: 1 },
          ]}
          onPress={() => onPress(emoji)}
        >
          <Text style={reactionSt.chipEmoji}>{emoji}</Text>
          {count > 1 && (
            <Text style={[reactionSt.chipCount, { color: mine ? colors.primary : colors.textSecondary }]}>
              {count}
            </Text>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const reactionSt = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2, marginHorizontal: SPACING.md },
  rowOwn: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  chip: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 6, paddingVertical: 3, gap: 3 },
  chipEmoji: { fontSize: 14 },
  chipCount: { fontSize: 11, fontWeight: '600' },
});

// ─── MessageBubble principal ──────────────────────────────────────────────────

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isOwn,
  currentUserId,
  onLongPress,
  onAIPress,
  onReaction,
}) => {
  const [showAI, setShowAI] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const scale = useSharedValue(1);
  const colors = useYoumeColors();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const myReaction = currentUserId && message.reactions
    ? message.reactions[currentUserId]
    : undefined;

  const getStatusIcon = () => {
    if (!isOwn) return null;
    switch (message.status) {
      case 'sending':   return <Ionicons name="time-outline"     size={12} color={colors.textMuted} />;
      case 'sent':      return <Ionicons name="checkmark"        size={12} color={colors.textMuted} />;
      case 'delivered': return <Ionicons name="checkmark-done"   size={12} color={colors.textMuted} />;
      case 'read':      return <Ionicons name="checkmark-done"   size={12} color={colors.delivered} />;
      default:          return null;
    }
  };

  const isMedia = message.type === 'image' || message.type === 'video';

  if (message.isDeleted) {
    return (
      <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
        <Text style={styles.deletedText}>
          <Ionicons name="ban-outline" size={12} /> Ce message a été supprimé.
        </Text>
      </View>
    );
  }

  if (message.type === 'location' && message.location) {
    return (
      <View style={[styles.wrapper, isOwn ? styles.wrapperOwn : styles.wrapperOther]}>
        <LocationBubble locationData={message.location} isOwn={isOwn} createdAt={message.createdAt} />
      </View>
    );
  }

  return (
    <View style={[styles.wrapper, isOwn ? styles.wrapperOwn : styles.wrapperOther]}>
      <AnimatedPressable
        style={animatedStyle}
        onPressIn={() => { scale.value = withSpring(0.97, { damping: 20, stiffness: 300 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 20, stiffness: 300 }); }}
        onLongPress={() => {
          // FIX BUG : l'appui long ne doit servir QU'À ouvrir le picker de
          // réaction. Auparavant on appelait aussi onLongPress?.(message) ici,
          // ce qui ouvrait EN MÊME TEMPS la fenêtre "Supprimer" (Alert) et le
          // picker d'emoji (Modal). Les deux se disputaient le toucher : le tap
          // sur un emoji pouvait être intercepté par l'Alert, et la réaction
          // semblait "disparaître" du message. La suppression passe désormais
          // par un bouton dédié (icône corbeille) plutôt que par ce geste.
          setShowPicker(true);
        }}
        delayLongPress={400}
      >
        <View style={[
          styles.bubble,
          isOwn ? styles.ownBubble : styles.otherBubble,
          isMedia && styles.mediaBubble,
        ]}>
          {message.type === 'voice' ? (
            <VoiceMessagePlayer
              localPath={message.voiceLocalPath ?? ''}
              storageUrl={message.storageUrl}
              messageId={message.id}
              conversationId={message.conversationId}
              duration={message.voiceDuration ?? 0}
              isOwn={isOwn}
            />
          ) : message.type === 'image' ? (
            <ImageBubble message={message} isOwn={isOwn} />
          ) : message.type === 'video' ? (
            <VideoBubble message={message} isOwn={isOwn} />
          ) : (
            <Text style={[styles.messageText, isOwn ? styles.ownText : styles.otherText]}>
              {message.content}
            </Text>
          )}

          {message.type === 'voice' && message.aiAnalysis?.transcription && (
            <Text style={styles.transcription}>
              "{message.aiAnalysis.transcription}"
            </Text>
          )}

          <View style={styles.footer}>
            {message.aiAnalysis && (
              <TouchableOpacity
                onPress={() => { setShowAI(!showAI); onAIPress?.(message); }}
                style={styles.aiButton}
              >
                <Ionicons name="sparkles" size={12} color={colors.primary} />
              </TouchableOpacity>
            )}
            {/* FIX BUG : la suppression est maintenant un bouton explicite,
                distinct de l'appui long qui ouvre le picker de réaction. */}
            {isOwn && (
              <TouchableOpacity
                onPress={() => onLongPress?.(message)}
                style={styles.deleteButton}
              >
                <Ionicons name="trash-outline" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            <Text style={styles.time}>{formatMessageTimestamp(message.createdAt)}</Text>
            {getStatusIcon()}
          </View>
        </View>
      </AnimatedPressable>

      {message.reactions && Object.keys(message.reactions).length > 0 && (
        <ReactionRow
          reactions={message.reactions}
          currentUserId={currentUserId}
          isOwn={isOwn}
          onPress={(emoji) => onReaction?.(message, emoji)}
        />
      )}

      {showAI && message.aiAnalysis?.emotions && (
        <EmotionBadge emotion={message.aiAnalysis.emotions} isOwn={isOwn} />
      )}

      <EmojiPicker
        visible={showPicker}
        currentEmoji={myReaction}
        onSelect={(emoji) => onReaction?.(message, emoji)}
        onClose={() => setShowPicker(false)}
      />
    </View>
  );
};

function getStyles(colors: YoumeColors) {
  return StyleSheet.create({
    wrapper: { paddingHorizontal: SPACING.md, marginVertical: 2 },
    wrapperOwn: { alignItems: 'flex-end' },
    wrapperOther: { alignItems: 'flex-start' },
    bubble: {
      maxWidth: '80%',
      borderRadius: BORDER_RADIUS.bubble,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      minWidth: 80,
    },
    mediaBubble: { paddingHorizontal: SPACING.xs, paddingVertical: SPACING.xs },
    ownBubble: { backgroundColor: colors.bubbleOwn, borderBottomRightRadius: 4 },
    otherBubble: { backgroundColor: colors.bubbleOther, borderBottomLeftRadius: 4 },
    messageText: { fontSize: TYPOGRAPHY.size.md, lineHeight: 20 },
    ownText: { color: colors.bubbleOwnText },
    otherText: { color: colors.bubbleOtherText },
    transcription: { fontSize: TYPOGRAPHY.size.xs, color: colors.textSecondary, fontStyle: 'italic', marginTop: 4 },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4, gap: 4 },
    time: { fontSize: TYPOGRAPHY.size.xs, color: colors.textMuted },
    aiButton: { padding: 2 },
    deleteButton: { padding: 2 },
    deletedText: { fontSize: TYPOGRAPHY.size.sm, color: colors.textMuted, fontStyle: 'italic' },
  });
}
