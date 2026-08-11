import { createRouter, createWebHistory } from 'vue-router';
import { useKioskStore } from '../stores/kioskStore';
import WelcomeView from '../views/WelcomeView.vue';
import TechnicianLayout from '../views/technician/TechnicianLayout.vue';
import TechnicianHubView from '../views/technician/TechnicianHubView.vue';
import TechnicianSettingsView from '../views/technician/TechnicianSettingsView.vue';
import TechnicianLogsView from '../views/technician/TechnicianLogsView.vue';
import TechnicianCashBoxView from '../views/technician/TechnicianCashBoxView.vue';
import BalanceView from '../views/BalanceView.vue';
import TransactionHistoryView from '../views/TransactionHistoryView.vue';
import TopUpView from '../views/TopUpView.vue';
import OutOfServiceView from '../views/OutOfServiceView.vue';
import { isOutOfService } from '../lib/kioskOutOfService';

const routes = [
    {
        path: '/',
        name: 'welcome',
        component: WelcomeView,
    },
    {
        path: '/manual-input',
        redirect: '/',
    },
    {
        path: '/technician',
        component: TechnicianLayout,
        children: [
            {
                path: '',
                name: 'technician-hub',
                component: TechnicianHubView,
            },
            {
                path: 'settings',
                name: 'technician-settings',
                component: TechnicianSettingsView,
            },
            {
                path: 'logs',
                name: 'technician-logs',
                component: TechnicianLogsView,
            },
            {
                path: 'cash-box',
                name: 'technician-cash-box',
                component: TechnicianCashBoxView,
            },
        ],
    },
    {
        path: '/technician/password',
        redirect: '/technician',
    },
    {
        path: '/balance',
        name: 'balance',
        component: BalanceView,
    },
    {
        path: '/history',
        name: 'history',
        component: TransactionHistoryView,
    },
    {
        path: '/topup',
        name: 'topup',
        component: TopUpView,
    },
    {
        path: '/out-of-service',
        name: 'out-of-service',
        component: OutOfServiceView,
    },
    {
        path: '/transfer',
        name: 'transfer',
        redirect: '/balance',
    },
    {
        path: '/:pathMatch(.*)*',
        redirect: '/',
    },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
});

const AUTH_ROUTE_NAMES = new Set(['balance', 'history', 'topup', 'transfer']);

router.beforeEach((to) => {
    if (isOutOfService()) {
        if (to.path.startsWith('/technician') || to.name === 'out-of-service') return true;
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
