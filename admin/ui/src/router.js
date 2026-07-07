import { createRouter, createWebHistory } from 'vue-router';
import { getMe } from './api';
export const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
        { path: '/', component: () => import('./views/DashboardView.vue'), meta: { admin: true } },
        { path: '/players', component: () => import('./views/PlayersView.vue'), meta: { admin: true } },
        { path: '/skinchanger', component: () => import('./views/SkinchangerView.vue') }
    ]
});
router.beforeEach(async (to) => {
    if (to.meta.public)
        return true;
    const me = await getMe();
    if (!me)
        return '/login';
    // Steam players without admin rights only get the skinchanger.
    if (to.meta.admin && !me.isAdmin)
        return '/skinchanger';
    return true;
});
