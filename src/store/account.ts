import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { Account } from '@/mail/types';

const KEY = 'mailapp.account.v1';

type AccountState = {
  account: Account | null;
  loaded: boolean;
  load: () => Promise<void>;
  save: (account: Account) => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAccount = create<AccountState>((set) => ({
  account: null,
  loaded: false,
  load: async () => {
    const raw = await SecureStore.getItemAsync(KEY);
    set({ account: raw ? (JSON.parse(raw) as Account) : null, loaded: true });
  },
  save: async (account) => {
    await SecureStore.setItemAsync(KEY, JSON.stringify(account), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    set({ account });
  },
  signOut: async () => {
    await SecureStore.deleteItemAsync(KEY);
    set({ account: null });
  },
}));
