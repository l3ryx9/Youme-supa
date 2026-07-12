/**
 * Store Zustand — Partenaires
 */
import { create } from 'zustand';
import type { Partner, PartnerRequest } from '@domain/entities/Partner';

interface PartnerState {
  partners: Partner[];
  pendingRequests: PartnerRequest[];
  sentRequests: PartnerRequest[];
  isLoading: boolean;
  error: string | null;

  setPartners: (partners: Partner[]) => void;
  setPendingRequests: (requests: PartnerRequest[]) => void;
  setSentRequests: (requests: PartnerRequest[]) => void;
  addPartner: (partner: Partner) => void;
  removePartner: (partnerId: string) => void;
  addPendingRequest: (request: PartnerRequest) => void;
  removePendingRequest: (requestId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const usePartnerStore = create<PartnerState>((set) => ({
  partners: [],
  pendingRequests: [],
  sentRequests: [],
  isLoading: false,
  error: null,

  setPartners: (partners) => set({ partners }),
  setPendingRequests: (pendingRequests) => set({ pendingRequests }),
  setSentRequests: (sentRequests) => set({ sentRequests }),
  addPartner: (partner) =>
    set((state) => ({ partners: [...state.partners, partner] })),
  removePartner: (partnerId) =>
    set((state) => ({ partners: state.partners.filter((p) => p.partnerId !== partnerId) })),
  addPendingRequest: (request) =>
    set((state) => ({ pendingRequests: [...state.pendingRequests, request] })),
  removePendingRequest: (requestId) =>
    set((state) => ({
      pendingRequests: state.pendingRequests.filter((r) => r.id !== requestId),
    })),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
