import { createRouter, createWebHistory } from 'vue-router';
import WelcomeView from '../views/WelcomeView.vue';
import TechnicianView from '../views/TechnicianView.vue';
import BalanceView from '../views/BalanceView.vue';
import TransactionHistoryView from '../views/TransactionHistoryView.vue';
import TopUpView from '../views/TopUpView.vue';
import TransferView from '../views/TransferView.vue';

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
        path: '/transfer',
        name: 'transfer',
        component: TransferView
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
