import { createRouter, createWebHistory } from 'vue-router';
import { useKioskStore } from '../stores/kioskStore';
import WelcomeView from '../views/WelcomeView.vue';
import TechnicianView from '../views/TechnicianView.vue';
import BalanceView from '../views/BalanceView.vue';
import TransactionHistoryView from '../views/TransactionHistoryView.vue';
import TopUpView from '../views/TopUpView.vue';
import OutOfServiceView from '../views/OutOfServiceView.vue';
import { isOutOfService } from '../lib/kioskOutOfService';
// TransferView kept (feature disabled) — flip TRANSFER_ENABLED in BalanceView
// and restore this route when re-enabling family transfer.
// import TransferView from '../views/TransferView.vue';

const routes = [
    {
        path: '/',
        name: 'welcome',
        component: WelcomeView
    },
    {
        path: '/manual-input',
        redirect: '/',
    },
    {
        path: '/technician',
        name: 'technician',
        component: TechnicianView,
    },
    {
        path: '/technician/password',
        redirect: '/technician',
    },
    {
        path: '/balance',
        name: 'balance',
        component: BalanceView
    },
    {
        path: '/history',
        name: 'history',
        component: TransactionHistoryView
    },
    {
        path: '/topup',
        name: 'topup',
        component: TopUpView
    },
    {
        path: '/out-of-service',
        name: 'out-of-service',
        component: OutOfServiceView,
    },
    {
        // Disabled for now — TransferView.vue remains in the repo.
        path: '/transfer',
        name: 'transfer',
        redirect: '/balance',
    },
    // Catch all - redirect to welcome
    {
        path: '/:pathMatch(.*)*',
        redirect: '/'
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

const AUTH_ROUTE_NAMES = new Set(['balance', 'history', 'topup', 'transfer']);

router.beforeEach((to) => {
    if (isOutOfService()) {
        if (to.name === 'out-of-service' || to.name === 'technician') return true;
        return { name: 'out-of-service' };
    }

    if (!AUTH_ROUTE_NAMES.has(String(to.name ?? ''))) return true;
    const store = useKioskStore();
    if (!store.isAuthenticated) {
        return { name: 'welcome' };
    }
    return true;
});

export default router;
