/**
 * Écran Partenaires
 */
import React, { useState, useEffect, useMemo } from 'react';
import { themedAlert } from '@presentation/components/common/ThemedAlert';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  SectionList,
} from 'react-native';
import { router } from 'expo-router';
import { Button, Chip, Divider, ActivityIndicator } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useYoumeColors, YoumeColors, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../../src/shared/constants/theme';
import { Avatar } from '../../../src/presentation/components/common/Avatar';
import { useAuthStore } from '../../../src/presentation/stores/authStore';
import { usePartnerStore } from '../../../src/presentation/stores/partnerStore';
import { partnerRepository } from '../../../src/infrastructure/firebase/PartnerRepository';
import type { Partner, PartnerRequest } from '../../../src/domain/entities/Partner';

type Tab = 'partners' | 'requests' | 'search';

export default function PartnersScreen() {
  const { user } = useAuthStore();
  const {
    partners,
    pendingRequests,
    setPartners,
    setPendingRequests,
    isLoading,
    setLoading,
  } = usePartnerStore();
  const [activeTab, setActiveTab] = useState<Tab>('partners');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [sendingRequest, setSendingRequest] = useState<string | null>(null);
  const colors = useYoumeColors();
  const styles = useMemo(() => getStyles(colors), [colors]);

  useEffect(() => {
    if (!user) return;
    const unsubPartners = partnerRepository.subscribeToPartners(user.id, setPartners);
    const unsubRequests = partnerRepository.subscribeToRequests(user.id, setPendingRequests);
    return () => { unsubPartners(); unsubRequests(); };
  }, [user]);

  const handleSearch = async () => {
    if (!searchQuery.trim() || searchQuery.length < 3) return;
    setIsSearching(true);
    try {
      const { userRepository } = await import('../../../src/infrastructure/firebase/UserRepository');
      const results = await userRepository.searchUsersByUsername(searchQuery);
      setSearchResults(results.filter((r) => r.id !== user?.id));
    } catch (error) {
      themedAlert.alert('Erreur', 'Recherche impossible');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSendRequest = async (receiverUsername: string) => {
    if (!user) return;
    setSendingRequest(receiverUsername);
    try {
      await partnerRepository.sendPartnerRequest({
        senderId: user.id,
        receiverUsername,
      });
      themedAlert.alert('Demande envoyée', `Votre demande de partenariat a été envoyée à @${receiverUsername}`);
    } catch (error: any) {
      themedAlert.alert('Erreur', error.message);
    } finally {
      setSendingRequest(null);
    }
  };

  const handleAccept = async (request: PartnerRequest) => {
    try {
      await partnerRepository.acceptPartnerRequest(request.id);
    } catch (error: any) {
      themedAlert.alert('Erreur', error.message);
    }
  };

  const handleReject = async (request: PartnerRequest) => {
    try {
      await partnerRepository.rejectPartnerRequest(request.id);
    } catch (error: any) {
      themedAlert.alert('Erreur', error.message);
    }
  };

  const handleRemovePartner = (partner: Partner) => {
    themedAlert.alert(
      'Supprimer le partenaire',
      `Voulez-vous supprimer @${partner.partnerUsername} de vos partenaires ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            await partnerRepository.removePartner(user.id, partner.partnerId);
          },
        },
      ]
    );
  };

  const renderPartner = ({ item }: { item: Partner }) => (
    <TouchableOpacity
      style={styles.item}
      onPress={() => router.push(`/(app)/chat/${item.conversationId}`)}
      onLongPress={() => handleRemovePartner(item)}
    >
      <Avatar
        displayName={item.partnerDisplayName}
        photoURL={item.partnerPhotoURL}
        size={50}
        isOnline={item.partnerIsOnline}
      />
      <View style={styles.itemContent}>
        <Text style={styles.itemName}>{item.partnerDisplayName}</Text>
        <Text style={styles.itemUsername}>@{item.partnerUsername}</Text>
      </View>
      <Ionicons name="chatbubble-outline" size={22} color={colors.primary} />
    </TouchableOpacity>
  );

  const renderRequest = ({ item }: { item: PartnerRequest }) => (
    <View style={styles.requestItem}>
      <Avatar displayName={item.senderDisplayName} photoURL={item.senderPhotoURL} size={48} />
      <View style={styles.itemContent}>
        <Text style={styles.itemName}>{item.senderDisplayName}</Text>
        <Text style={styles.itemUsername}>@{item.senderUsername}</Text>
      </View>
      <View style={styles.requestActions}>
        <TouchableOpacity style={styles.acceptButton} onPress={() => handleAccept(item)}>
          <Ionicons name="checkmark" size={18} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.rejectButton} onPress={() => handleReject(item)}>
          <Ionicons name="close" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Partenaires</Text>
        {pendingRequests.length > 0 && (
          <View style={styles.requestBadge}>
            <Text style={styles.requestBadgeText}>{pendingRequests.length}</Text>
          </View>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['partners', 'requests', 'search'] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'partners' ? `Mes partenaires (${partners.length})` :
               tab === 'requests' ? `Demandes (${pendingRequests.length})` : 'Rechercher'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Contenu */}
      {activeTab === 'partners' && (
        <FlatList
          data={partners}
          renderItem={renderPartner}
          keyExtractor={(item) => item.partnerId}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={56} color={colors.textMuted} />
              <Text style={styles.emptyText}>Aucun partenaire</Text>
              <Text style={styles.emptySubtext}>Recherchez des utilisateurs par username</Text>
            </View>
          }
        />
      )}

      {activeTab === 'requests' && (
        <FlatList
          data={pendingRequests}
          renderItem={renderRequest}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="mail-outline" size={56} color={colors.textMuted} />
              <Text style={styles.emptyText}>Aucune demande en attente</Text>
            </View>
          }
        />
      )}

      {activeTab === 'search' && (
        <View style={styles.searchTab}>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Rechercher un username..."
              placeholderTextColor={colors.placeholder}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              autoCapitalize="none"
              returnKeyType="search"
            />
            <TouchableOpacity style={styles.searchButton} onPress={handleSearch} disabled={isSearching}>
              {isSearching ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="search" size={20} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>

          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.item}>
                <Avatar displayName={item.displayName} photoURL={item.photoURL} size={48} />
                <View style={styles.itemContent}>
                  <Text style={styles.itemName}>{item.displayName}</Text>
                  <Text style={styles.itemUsername}>@{item.username}</Text>
                </View>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => handleSendRequest(item.username)}
                  disabled={sendingRequest === item.username}
                >
                  {sendingRequest === item.username ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons name="person-add" size={18} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      )}
    </View>
  );
}

function getStyles(colors: YoumeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: 48,
      paddingBottom: SPACING.sm,
      paddingHorizontal: SPACING.md,
      backgroundColor: colors.secondary,
      gap: SPACING.sm,
    },
    headerTitle: { fontSize: TYPOGRAPHY.size.xl, fontWeight: '700', color: colors.textPrimary, flex: 1 },
    requestBadge: {
      backgroundColor: colors.error,
      borderRadius: 10,
      minWidth: 20,
      height: 20,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 5,
    },
    requestBadgeText: { fontSize: 11, color: '#FFFFFF', fontWeight: '700' },
    tabs: {
      flexDirection: 'row',
      backgroundColor: colors.secondary,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    tab: { flex: 1, paddingVertical: SPACING.sm, alignItems: 'center' },
    tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
    tabText: { fontSize: TYPOGRAPHY.size.xs, color: colors.textMuted },
    tabTextActive: { color: colors.primary, fontWeight: '600' },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      gap: SPACING.md,
    },
    requestItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.md,
      gap: SPACING.md,
    },
    itemContent: { flex: 1 },
    itemName: { fontSize: TYPOGRAPHY.size.md, fontWeight: '600', color: colors.textPrimary },
    itemUsername: { fontSize: TYPOGRAPHY.size.sm, color: colors.textSecondary },
    requestActions: { flexDirection: 'row', gap: SPACING.sm },
    acceptButton: {
      backgroundColor: colors.success,
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rejectButton: {
      backgroundColor: colors.error,
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
    separator: { height: 1, backgroundColor: colors.divider, marginLeft: 80 },
    empty: { alignItems: 'center', paddingTop: 60, gap: SPACING.sm },
    emptyText: { fontSize: TYPOGRAPHY.size.lg, color: colors.textSecondary, fontWeight: '600' },
    emptySubtext: { fontSize: TYPOGRAPHY.size.sm, color: colors.textMuted, textAlign: 'center' },
    searchTab: { flex: 1, padding: SPACING.md, gap: SPACING.md },
    searchRow: { flexDirection: 'row', gap: SPACING.sm },
    searchInput: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      color: colors.textPrimary,
      fontSize: TYPOGRAPHY.size.md,
    },
    searchButton: {
      backgroundColor: colors.primary,
      width: 44,
      height: 44,
      borderRadius: BORDER_RADIUS.md,
      justifyContent: 'center',
      alignItems: 'center',
    },
    addButton: {
      backgroundColor: colors.primary,
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
}
