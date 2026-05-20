import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { realApi } from '../api/realApi';
import type { User, Transaction } from '../api/mockApi';

export const useKioskStore = defineStore('kiosk', () => {
    const currentUser = ref<User | null>(null);
    const transactions = ref<Transaction[]>([]);
    const isLoading = ref(false);
    const language = ref<'TH' | 'EN'>('EN');
    const lastActivity = ref(Date.now());
    const activeWalletIndex = ref(0);
    const schoolInfo = ref<{ school_name: string; school_logo_url: string }>({ school_name: '', school_logo_url: '' });
    const loginSource = ref<'rfid' | 'manual'>('rfid');
    // Index of the wallet whose transactions are currently loaded (-1 = parent's active wallet)
    const transactionWalletIndex = ref(-1);

    const isAuthenticated = computed(() => !!currentUser.value);

    const currentWallet = computed(() => {
        if (!currentUser.value || !currentUser.value.wallets.length) return null;
        return currentUser.value.wallets[activeWalletIndex.value];
    });

    function setLanguage(lang: 'TH' | 'EN') {
        language.value = lang;
        updateActivity();
    }

    function setActiveWallet(index: number) {
        if (currentUser.value && index >= 0 && index < currentUser.value.wallets.length) {
            activeWalletIndex.value = index;
        }
    }

    function updateActivity() {
        lastActivity.value = Date.now();
    }

    async function login(identifier: string, source: 'rfid' | 'manual' = 'rfid') {
        isLoading.value = true;
        try {
            const user = await realApi.checkBalance(identifier);
            if (user) {
                currentUser.value = user;
                loginSource.value = source;

                // Default to the wallet matching the cardId if possible, or 0
                const walletIndex = user.wallets.findIndex(
                    w => w.cardId.toLowerCase() === identifier.toLowerCase(),
                );
                activeWalletIndex.value = walletIndex >= 0 ? walletIndex : 0;

                // Fetch transactions using the active wallet's ID
                const walletId = user.wallets[activeWalletIndex.value]?.id ?? null;
                transactions.value = walletId
                    ? await realApi.getLatestTransactions(walletId)
                    : [];
                transactionWalletIndex.value = activeWalletIndex.value;

                updateActivity();
                return true;
            }
            return false;
        } finally {
            isLoading.value = false;
        }
    }

    function logout() {
        currentUser.value = null;
        transactions.value = [];
        activeWalletIndex.value = 0;
        loginSource.value = 'rfid';
        transactionWalletIndex.value = -1;
    }

    async function refreshTransactions(walletId: string, walletIndex?: number) {
        try {
            transactions.value = await realApi.getLatestTransactions(walletId);
            if (walletIndex !== undefined) {
                transactionWalletIndex.value = walletIndex;
            }
        } catch { /* silent */ }
    }

    async function refreshBalance() {
        if (!currentUser.value) return;
        const identifier = currentUser.value.employeeId;
        const prevWalletIndex = activeWalletIndex.value;
        try {
            const user = await realApi.checkBalance(identifier);
            if (user) {
                currentUser.value = user;
                activeWalletIndex.value = Math.min(prevWalletIndex, user.wallets.length - 1);
            }
            const walletId = currentWallet.value?.id ?? null;
            if (walletId) {
                transactions.value = await realApi.getLatestTransactions(walletId);
                transactionWalletIndex.value = activeWalletIndex.value;
            }
        } catch { /* silent — stale data is acceptable */ }
    }

    async function fetchSchoolInfo() {
        try {
            schoolInfo.value = await realApi.getPublicSettings();
        } catch {}
    }

    return {
        currentUser,
        currentWallet,
        activeWalletIndex,
        transactions,
        isLoading,
        language,
        lastActivity,
        isAuthenticated,
        loginSource,
        transactionWalletIndex,
        setLanguage,
        setActiveWallet,
        updateActivity,
        login,
        logout,
        refreshBalance,
        refreshTransactions,
        schoolInfo,
        fetchSchoolInfo,
    };
});
