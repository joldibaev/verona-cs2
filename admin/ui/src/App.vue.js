import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import { clearMe, getMe } from './api';
import { faceitLevel } from './faceit';
const route = useRoute();
const router = useRouter();
const isLogin = computed(() => route.path === '/login');
const me = ref(null);
watch(() => route.path, async () => { if (!isLogin.value)
    me.value = await getMe(); }, { immediate: true });
const links = computed(() => me.value?.isAdmin
    ? [{ to: '/', label: 'Серверы' }, { to: '/players', label: 'Игроки' }, { to: '/skinchanger', label: 'Skinchanger' }]
    : [{ to: '/skinchanger', label: 'Skinchanger' }]);
const currentFaceitLevel = computed(() => me.value?.faceitElo ? faceitLevel(me.value.faceitElo) : 0);
async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); clearMe(); await router.push('/login'); }
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
let __VLS_0;
/** @ts-ignore @type {typeof __VLS_components.Toast} */
Toast;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({}));
const __VLS_2 = __VLS_1({}, ...__VLS_functionalComponentArgsRest(__VLS_1));
let __VLS_5;
/** @ts-ignore @type {typeof __VLS_components.ConfirmDialog} */
ConfirmDialog;
// @ts-ignore
const __VLS_6 = __VLS_asFunctionalComponent1(__VLS_5, new __VLS_5({}));
const __VLS_7 = __VLS_6({}, ...__VLS_functionalComponentArgsRest(__VLS_6));
if (__VLS_ctx.isLogin) {
    let __VLS_10;
    /** @ts-ignore @type {typeof __VLS_components.RouterView} */
    RouterView;
    // @ts-ignore
    const __VLS_11 = __VLS_asFunctionalComponent1(__VLS_10, new __VLS_10({}));
    const __VLS_12 = __VLS_11({}, ...__VLS_functionalComponentArgsRest(__VLS_11));
}
else {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "app-shell" },
    });
    /** @type {__VLS_StyleScopedClasses['app-shell']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.header, __VLS_intrinsics.header)({
        ...{ class: "topbar" },
    });
    /** @type {__VLS_StyleScopedClasses['topbar']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "topbar-inner" },
    });
    /** @type {__VLS_StyleScopedClasses['topbar-inner']} */ ;
    let __VLS_15;
    /** @ts-ignore @type {typeof __VLS_components.RouterLink | typeof __VLS_components.RouterLink} */
    RouterLink;
    // @ts-ignore
    const __VLS_16 = __VLS_asFunctionalComponent1(__VLS_15, new __VLS_15({
        to: "/",
        ...{ class: "wordmark" },
    }));
    const __VLS_17 = __VLS_16({
        to: "/",
        ...{ class: "wordmark" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_16));
    /** @type {__VLS_StyleScopedClasses['wordmark']} */ ;
    const { default: __VLS_20 } = __VLS_18.slots;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    // @ts-ignore
    [isLogin,];
    var __VLS_18;
    __VLS_asFunctionalElement1(__VLS_intrinsics.nav, __VLS_intrinsics.nav)({});
    for (const [link] of __VLS_vFor((__VLS_ctx.links))) {
        let __VLS_21;
        /** @ts-ignore @type {typeof __VLS_components.RouterLink | typeof __VLS_components.RouterLink} */
        RouterLink;
        // @ts-ignore
        const __VLS_22 = __VLS_asFunctionalComponent1(__VLS_21, new __VLS_21({
            key: (link.to),
            to: (link.to),
        }));
        const __VLS_23 = __VLS_22({
            key: (link.to),
            to: (link.to),
        }, ...__VLS_functionalComponentArgsRest(__VLS_22));
        const { default: __VLS_26 } = __VLS_24.slots;
        (link.label);
        // @ts-ignore
        [links,];
        var __VLS_24;
        // @ts-ignore
        [];
    }
    if (__VLS_ctx.me) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "account" },
        });
        /** @type {__VLS_StyleScopedClasses['account']} */ ;
        if (__VLS_ctx.me.faceitElo) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "elo-badge" },
            });
            /** @type {__VLS_StyleScopedClasses['elo-badge']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
                src: (`/faceit/lvl${__VLS_ctx.currentFaceitLevel}.svg`),
                ...{ class: "elo-level-img" },
                alt: (`Level ${__VLS_ctx.currentFaceitLevel}`),
            });
            /** @type {__VLS_StyleScopedClasses['elo-level-img']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (__VLS_ctx.me.faceitElo);
        }
        if (__VLS_ctx.me.avatarUrl) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
                src: (__VLS_ctx.me.avatarUrl),
                alt: "",
            });
        }
        else {
            __VLS_asFunctionalElement1(__VLS_intrinsics.i)({
                ...{ class: "pi pi-user" },
            });
            /** @type {__VLS_StyleScopedClasses['pi']} */ ;
            /** @type {__VLS_StyleScopedClasses['pi-user']} */ ;
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (__VLS_ctx.me.name);
        let __VLS_27;
        /** @ts-ignore @type {typeof __VLS_components.Button} */
        Button;
        // @ts-ignore
        const __VLS_28 = __VLS_asFunctionalComponent1(__VLS_27, new __VLS_27({
            ...{ 'onClick': {} },
            icon: "pi pi-sign-out",
            text: true,
            rounded: true,
            severity: "secondary",
            'aria-label': "Выйти",
        }));
        const __VLS_29 = __VLS_28({
            ...{ 'onClick': {} },
            icon: "pi pi-sign-out",
            text: true,
            rounded: true,
            severity: "secondary",
            'aria-label': "Выйти",
        }, ...__VLS_functionalComponentArgsRest(__VLS_28));
        let __VLS_32;
        const __VLS_33 = ({ click: {} },
            { onClick: (__VLS_ctx.logout) });
        var __VLS_30;
        var __VLS_31;
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.main, __VLS_intrinsics.main)({
        ...{ class: "content" },
    });
    /** @type {__VLS_StyleScopedClasses['content']} */ ;
    let __VLS_34;
    /** @ts-ignore @type {typeof __VLS_components.RouterView} */
    RouterView;
    // @ts-ignore
    const __VLS_35 = __VLS_asFunctionalComponent1(__VLS_34, new __VLS_34({}));
    const __VLS_36 = __VLS_35({}, ...__VLS_functionalComponentArgsRest(__VLS_35));
}
// @ts-ignore
[me, me, me, me, me, me, currentFaceitLevel, currentFaceitLevel, logout,];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
