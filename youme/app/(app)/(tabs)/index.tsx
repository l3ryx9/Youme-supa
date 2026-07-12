/**
 * Écran Principal — Liste des Conversations
 */
import React, { useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ImageBackground,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Searchbar, FAB } from 'react-native-paper';
import Animated, { FadeInUp, Layout } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useYoumeColors, YoumeColors, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../../src/shared/constants/theme';
import { Avatar } from '../../../src/presentation/components/common/Avatar';
import { formatConversationDate } from '../../../src/shared/utils/dateUtils';
import { useAuthStore } from '../../../src/presentation/stores/authStore';
import { useConversationStore } from '../../../src/presentation/stores/conversationStore';
import type { ConversationWithPartner } from '../../../src/domain/entities/Conversation';
import { conversationRepository } from '../../../src/infrastructure/supabase/ConversationRepository';

export default function ConversationsScreen() {
  const { user } = useAuthStore();
  const { conversations, setConversations, removeConversation, isLoading } = useConversationStore();
  const [search, setSearch] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);
  const colors = useYoumeColors();
  const styles = useMemo(() => getStyles(colors), [colors]);

  useEffect(() => {
    if (!user) return;
    // Le profil public (pseudo, avatar, statut en ligne) est la source de
    // vérité pour l'affichage du partenaire ; le ConversationRepository l'y
    // résout automatiquement pour chaque conversation.
    const unsubscribe = conversationRepository.subscribeToConversations(
      user.id,
      setConversations
    );
    return () => unsubscribe();
  }, [user]);

  const handleDeleteConversation = useCallback((item: ConversationWithPartner) => {
    Alert.alert(
      'Supprimer la conversation',
      `Voulez-vous supprimer la conversation avec ${item.partnerDisplayName} ?`,
      [
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await conversationRepository.deleteConversation(item.id);
              removeConversation(item.id);
            } catch {
              Alert.alert('Erreur', 'Impossible de supprimer la conversation.');
            }
          },
        },
        { text: 'Annuler', style: 'cancel' },
      ]
    );
  }, [removeConversation]);

  const filtered = conversations.filter(
    (c) =>
      c.partnerDisplayName.toLowerCase().includes(search.toLowerCase()) ||
      c.partnerUsername.toLowerCase().includes(search.toLowerCase())
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ConversationWithPartner; index: number }) => (
      <Animated.View entering={FadeInUp.delay(index * 30)} layout={Layout.springify()}>
        <TouchableOpacity
          style={styles.item}
          onPress={() => router.push(`/(app)/chat/${item.id}`)}
          onLongPress={() => handleDeleteConversation(item)}
          delayLongPress={400}
          activeOpacity={0.7}
        >
          <Avatar
            displayName={item.partnerDisplayName}
            photoURL={item.partnerPhotoURL}
            size={52}
            isOnline={item.partnerIsOnline}
          />
          <View style={styles.itemContent}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemName} numberOfLines={1}>
                {item.partnerDisplayName}
              </Text>
              <Text style={styles.itemTime}>
                {item.lastMessage ? formatConversationDate(item.lastMessage.createdAt?.toDate?.() ?? item.updatedAt) : ''}
              </Text>
            </View>
            <View style={styles.itemFooter}>
              <Text style={styles.itemLastMessage} numberOfLines={1}>
                {item.lastMessage?.type === 'voice'
                  ? '🎤 Message vocal'
                  : item.lastMessage?.content ?? 'Commencer la conversation'}
              </Text>
              {item.unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{item.unreadCount}</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    ),
    [styles, handleDeleteConversation]
  );

  return (
    <ImageBackground
      source={require('../../../assets/images/logo-splash.png')}
      style={styles.container}
      imageStyle={styles.backgroundImage}
    >
      {/* Header — logo + fougères */}
      <View style={styles.header}>
        {/* Fougères décoratives gauche */}
        <View style={styles.fernsLeft} pointerEvents="none">
          <Text style={styles.fernLeaf}>🌿</Text>
          <Text style={[styles.fernLeaf, styles.fernLeafSmall]}>🍃</Text>
        </View>

        {/* Fougères décoratives droite */}
        <View style={styles.fernsRight} pointerEvents="none">
          <Text style={[styles.fernLeaf, styles.fernLeafSmall]}>🍃</Text>
          <Text style={styles.fernLeaf}>🌿</Text>
        </View>
      </View>

      {/* Barre de recherche */}
      <View style={styles.searchContainer}>
        <Searchbar
          placeholder="Rechercher..."
          value={search}
          onChangeText={setSearch}
          style={styles.searchBar}
          inputStyle={styles.searchInput}
          iconColor={colors.textSecondary}
          placeholderTextColor={colors.placeholder}
        />
      </View>

      {/* Liste des conversations */}
      <FlatList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => setRefreshing(false)}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={64} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Aucune conversation</Text>
            <Text style={styles.emptySubtitle}>
              Ajoutez des partenaires pour commencer à discuter
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </ImageBackground>
  );
}

function getStyles(colors: YoumeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: SPACING.md,
      paddingTop: 48,
      paddingBottom: SPACING.sm,
      backgroundColor: colors.secondary,
      overflow: 'hidden',
    },
    backgroundImage: {
      opacity: 0.07,
      resizeMode: 'contain',
    },
    fernsLeft: {
      position: 'absolute',
      left: SPACING.md,
      bottom: 2,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 2,
      opacity: 0.7,
    },
    fernsRight: {
      position: 'absolute',
      right: SPACING.md,
      bottom: 2,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 2,
      opacity: 0.7,
    },
    fernLeaf: {
      fontSize: 20,
      lineHeight: 22,
    },
    fernLeafSmall: {
      fontSize: 14,
      lineHeight: 16,
    },
    searchContainer: { padding: SPACING.sm, backgroundColor: colors.secondary },
    searchBar: { backgroundColor: colors.surface, elevation: 0 },
    searchInput: { color: colors.textPrimary, fontSize: TYPOGRAPHY.size.md },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      gap: SPACING.md,
      backgroundColor: colors.background,
    },
    itemContent: { flex: 1 },
    itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    itemName: { fontSize: TYPOGRAPHY.size.md, fontWeight: '600', color: colors.textPrimary, flex: 1 },
    itemTime: { fontSize: TYPOGRAPHY.size.xs, color: colors.textMuted, marginLeft: SPACING.sm },
    itemFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
    itemLastMessage: { flex: 1, fontSize: TYPOGRAPHY.size.sm, color: colors.textSecondary },
    unreadBadge: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      minWidth: 20,
      height: 20,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    unreadText: { fontSize: TYPOGRAPHY.size.xs, color: '#FFFFFF', fontWeight: '700' },
    separator: { height: 1, backgroundColor: colors.divider, marginLeft: 80 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: SPACING.md },
    emptyTitle: { fontSize: TYPOGRAPHY.size.lg, color: colors.textSecondary, fontWeight: '600' },
    emptySubtitle: { fontSize: TYPOGRAPHY.size.sm, color: colors.textMuted, textAlign: 'center' },
  });
}
