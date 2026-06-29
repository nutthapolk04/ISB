import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { realApi } from '../api/realApi';
import type { User, Transaction } from '../api/mockApi';

export type BootStatus = 'loading' | 'ready' | 'error';
export type LoginFailureReason = 'not_found' | 'network' | 'busy';

export type LoginResult =
    | { ok: true }
    | { ok: false; reason: LoginFailureReason };

export const useKioskStore = defineStore('kiosk', () => {
    const currentUser = ref<User | null>(null);
    const transactions = ref<Transaction[]>([]);
    const isLoading = ref(false);
    const bootStatus = ref<BootStatus>('loading');
    const bootError = ref<string | null>(null);
    const language = ref<'TH' | 'EN'>('EN');
    const lastActivity = ref(Date.now());
    const activeWalletIndex = ref(0);
    const schoolInfo = ref<{ school_name: string; school_logo_url: string }>({ school_name: '', school_logo_url: '' });
    const loginSource = ref<'rfid' | 'manual'>('rfid');
    const transactionWalletIndex = ref(-1);

    const isReady = computed(() => bootStatus.value === 'ready');
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

    async function fetchSchoolInfo() {
        try {
            schoolInfo.value = await realApi.getPublicSettings();
        } catch {
            /* optional branding — boot can still succeed */
        }
    }

    async function bootstrap() {
        bootStatus.value = 'loading';
        bootError.value = null;
        try {
            await realApi.init();
            await fetchSchoolInfo();
            bootStatus.value = 'ready';
        } catch (e) {
            bootStatus.value = 'error';
            bootError.value = e instanceof Error ? e.message : 'Could not connect to server';
            console.warn('[KioskStore] bootstrap failed:', e);
        }
    }

    async function login(identifier: string, source: 'rfid' | 'manual' = 'rfid'): Promise<LoginResult> {
        if (isLoading.value) {
            return { ok: false, reason: 'busy' };
        }
        if (bootStatus.value !== 'ready') {
            return { ok: false, reason: 'network' };
        }

        isLoading.value = true;
        try {
            const user = await realApi.checkBalance(identifier);
            if (user) {
                currentUser.value = user;
                loginSource.value = source;

                const walletIndex = user.wallets.findIndex(
                    w => w.cardId.toLowerCase() === identifier.toLowerCase(),
                );
                activeWalletIndex.value = walletIndex >= 0 ? walletIndex : 0;

                const walletId = user.wallets[activeWalletIndex.value]?.id ?? null;
                transactions.value = walletId
                    ? await realApi.getLatestTransactions(walletId)
                    : [];
                transactionWalletIndex.value = activeWalletIndex.value;

                updateActivity();
                return { ok: true };
            }
            return { ok: false, reason: 'not_found' };
        } catch (e) {
            console.warn('[KioskStore] login failed:', e);
            return { ok: false, reason: 'network' };
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
        if (!currentUser.value || isLoading.value) return;
        const identifier = currentUser.value.employeeId;
        const prevWalletIndex = activeWalletIndex.value;
        isLoading.value = true;
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
        } catch { /* stale data acceptable */ }
        finally {
            isLoading.value = false;
        }
    }

    return {
        currentUser,
        currentWallet,
        activeWalletIndex,
        transactions,
        isLoading,
        bootStatus,
        bootError,
        isReady,
        language,
        lastActivity,
        isAuthenticated,
        loginSource,
        transactionWalletIndex,
        setLanguage,
        setActiveWallet,
        updateActivity,
        bootstrap,
        login,
        logout,
        refreshBalance,
        refreshTransactions,
        schoolInfo,
        fetchSchoolInfo,
    };
});
