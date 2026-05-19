import { createRouter, createWebHistory } from 'vue-router';
import WelcomeView from '../views/WelcomeView.vue';
import ManualInputView from '../views/ManualInputView.vue';
import BalanceView from '../views/BalanceView.vue';
import TransactionHistoryView from '../views/TransactionHistoryView.vue';
import TopUpView from '../views/TopUpView.vue';

const routes = [
    {
        path: '/',
        name: 'welcome',
        component: WelcomeView
    },
    {
        path: '/manual-input',
        name: 'manual-input',
        component: ManualInputView
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
