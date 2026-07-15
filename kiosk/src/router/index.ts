import { createRouter, createWebHistory } from 'vue-router';
import WelcomeView from '../views/WelcomeView.vue';
import TechnicianView from '../views/TechnicianView.vue';
import BalanceView from '../views/BalanceView.vue';
import TransactionHistoryView from '../views/TransactionHistoryView.vue';
import TopUpView from '../views/TopUpView.vue';
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

export default router;
