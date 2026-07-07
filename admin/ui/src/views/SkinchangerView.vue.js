import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Slider from 'primevue/slider';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import { api, getMe } from '../api';
import { faceitLevel } from '../faceit';
const categories = [
    { id: 'sfui_invpanel_filter_melee', label: 'Ножи' },
    { id: 'all', label: 'Всё' },
    { id: 'csgo_inventory_weapon_category_pistols', label: 'Пистолеты' },
    { id: 'csgo_inventory_weapon_category_rifles', label: 'Винтовки' },
    { id: 'csgo_inventory_weapon_category_smgs', label: 'SMG' },
    { id: 'csgo_inventory_weapon_category_heavy', label: 'Тяжёлое' },
    { id: 'loadoutslot_equipment', label: 'Zeus' }
];
const me = ref(null);
const weapons = ref([]);
const skinsByWeapon = ref(new Map());
const mySkins = ref({});
const category = ref('all');
const search = ref('');
const loading = ref(true);
const toast = useToast();
const confirm = useConfirm();
const route = useRoute();
// Admins can retarget the editor at any account the server has ever seen.
const players = ref([]);
const target = ref(null);
const editingSelf = computed(() => !me.value?.isAdmin || !target.value || target.value.steamId === me.value?.steamId);
// This is UX only. Backend is the security boundary: /api/me derives SteamID from
// the session, while an arbitrary /api/players target requires an admin session.
const basePath = computed(() => editingSelf.value ? '/api/me/skins' : `/api/players/${target.value.steamId}/skins`);
const profile = computed(() => editingSelf.value
    ? me.value && ({ steamId: me.value.steamId, name: me.value.name, avatarUrl: me.value.avatarUrl,
        profileUrl: `https://steamcommunity.com/profiles/${me.value.steamId}`, faceitElo: me.value.faceitElo, faceitNickname: me.value.faceitNickname })
    : target.value);
const visibleWeapons = computed(() => {
    const query = search.value.trim().toLowerCase();
    return weapons.value.filter(w => (category.value === 'all' || w.category === category.value) &&
        (!query || w.name.toLowerCase().includes(query) || (currentSkin(w.weapon)?.name ?? '').toLowerCase().includes(query)));
});
function currentSkin(weapon) {
    const applied = mySkins.value[weapon];
    if (!applied)
        return null;
    return skinsByWeapon.value.get(weapon)?.find(s => s.paint === applied.paintKit) ?? null;
}
async function loadSkins() {
    if (me.value?.isAdmin && !target.value) {
        mySkins.value = {};
        return;
    }
    const list = await api(basePath.value);
    mySkins.value = Object.fromEntries(list.map(s => [s.weapon, s]));
}
async function retarget() { await loadSkins(); }
// Skin picker dialog state.
const dialog = ref(false);
const dialogWeapon = ref(null);
const dialogSearch = ref('');
const picked = ref(null);
const wear = ref(0.01);
const seed = ref(0);
const saving = ref(false);
const collections = ref([]);
const collectionDialog = ref(false);
const collectionName = ref('');
const dialogSkins = computed(() => {
    const all = dialogWeapon.value ? (skinsByWeapon.value.get(dialogWeapon.value.weapon) ?? []) : [];
    const query = dialogSearch.value.trim().toLowerCase();
    return query ? all.filter(s => s.name.toLowerCase().includes(query)) : all;
});
function openWeapon(weapon) {
    if (editingSelf.value && collections.value.length === 0) {
        toast.add({ severity: 'warn', summary: 'Внимание', detail: 'Необходимо создать коллекцию перед выбором скинов', life: 4000 });
        return;
    }
    dialogWeapon.value = weapon;
    dialogSearch.value = '';
    picked.value = currentSkin(weapon.weapon);
    const applied = mySkins.value[weapon.weapon];
    wear.value = applied?.wear ?? 0.01;
    seed.value = applied?.seed ?? 0;
    dialog.value = true;
}
function pick(skin) {
    picked.value = skin;
    wear.value = Math.min(Math.max(wear.value, skin.minWear), skin.maxWear);
}
async function save() {
    if (!dialogWeapon.value || !picked.value)
        return;
    saving.value = true;
    try {
        await api(`${basePath.value}/${dialogWeapon.value.weapon}`, {
            method: 'PUT',
            body: JSON.stringify({ weapon: dialogWeapon.value.weapon, paintKit: picked.value.paint, wear: wear.value, seed: seed.value })
        });
        await loadSkins();
        dialog.value = false;
        toast.add({ severity: 'success', summary: 'Скин сохранён', detail: `${picked.value.name} применится при следующей выдаче оружия`, life: 3000 });
    }
    catch (e) {
        toast.add({ severity: 'error', summary: 'Ошибка', detail: String(e), life: 4000 });
    }
    finally {
        saving.value = false;
    }
}
async function resetSkin() {
    if (!dialogWeapon.value || !mySkins.value[dialogWeapon.value.weapon]) {
        dialog.value = false;
        return;
    }
    saving.value = true;
    try {
        await api(`${basePath.value}/${dialogWeapon.value.weapon}`, { method: 'DELETE' });
        await loadSkins();
        dialog.value = false;
        toast.add({ severity: 'success', summary: 'Скин сброшен', life: 2500 });
    }
    catch (e) {
        toast.add({ severity: 'error', summary: 'Ошибка', detail: String(e), life: 4000 });
    }
    finally {
        saving.value = false;
    }
}
async function loadCollections() {
    if (editingSelf.value) {
        collections.value = await api('/api/me/collections');
        if (collections.value.length === 0) {
            await api('/api/me/collections', {
                method: 'POST',
                body: JSON.stringify({ name: 'По умолчанию' })
            });
            collections.value = await api('/api/me/collections');
            await loadSkins();
        }
    }
}
async function createCollection() { const name = collectionName.value.trim(); if (!name)
    return; await api('/api/me/collections', { method: 'POST', body: JSON.stringify({ name }) }); collectionName.value = ''; collectionDialog.value = false; await loadCollections(); }
async function activateCollection(item) { if (item.active)
    return; await api(`/api/me/collections/${item.id}/activate`, { method: 'POST' }); await Promise.all([loadCollections(), loadSkins()]); }
async function confirmDeleteCollection(item) {
    confirm.require({
        message: `Вы уверены, что хотите удалить коллекцию "${item.name}"?`,
        header: 'Подтверждение удаления',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: 'Отмена', severity: 'secondary', text: true },
        acceptProps: { label: 'Удалить', severity: 'danger' },
        accept: async () => {
            try {
                await api(`/api/me/collections/${item.id}`, { method: 'DELETE' });
                toast.add({ severity: 'success', summary: 'Коллекция удалена', life: 2500 });
                await Promise.all([loadCollections(), loadSkins()]);
            }
            catch (e) {
                toast.add({ severity: 'error', summary: 'Ошибка', detail: String(e), life: 4000 });
            }
        }
    });
}
const importDialog = ref(false);
const importCode = ref('');
async function shareCollection(item) {
    try {
        const skins = await api(`/api/me/collections/${item.id}/skins`);
        const data = {
            name: item.name,
            skins: skins.map(s => ({ weapon: s.weapon, paintKit: s.paintKit, wear: s.wear, seed: s.seed }))
        };
        const code = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
        await navigator.clipboard.writeText(code);
        toast.add({ severity: 'success', summary: 'Код скопирован', detail: 'Код коллекции скопирован в буфер обмена', life: 3000 });
    }
    catch (e) {
        toast.add({ severity: 'error', summary: 'Ошибка', detail: String(e), life: 4000 });
    }
}
async function importCollection() {
    const code = importCode.value.trim();
    if (!code)
        return;
    try {
        const raw = decodeURIComponent(escape(atob(code)));
        const data = JSON.parse(raw);
        if (!data.name || !Array.isArray(data.skins)) {
            throw new Error('Неверный формат кода коллекции');
        }
        await api('/api/me/collections', {
            method: 'POST',
            body: JSON.stringify({ name: data.name, skins: data.skins })
        });
        importCode.value = '';
        importDialog.value = false;
        toast.add({ severity: 'success', summary: 'Коллекция импортирована', life: 3000 });
        await loadCollections();
    }
    catch (e) {
        toast.add({ severity: 'error', summary: 'Ошибка импорта', detail: 'Не удалось распознать код коллекции. Убедитесь, что скопировали его полностью.', life: 4000 });
    }
}
onMounted(async () => {
    me.value = await getMe();
    // Catalog metadata is public/static for cache-friendly delivery. Save endpoints
    // still validate submitted values because browser data is never trusted.
    const catalog = await (await fetch('/skins-catalog.json')).json();
    weapons.value = catalog.weapons;
    const grouped = new Map();
    for (const skin of catalog.skins) {
        const list = grouped.get(skin.weapon) ?? [];
        list.push(skin);
        grouped.set(skin.weapon, list);
    }
    skinsByWeapon.value = grouped;
    if (me.value?.isAdmin) {
        players.value = await api('/api/players/known');
        const requestedSteamId = typeof route.query.steamId === 'string' ? route.query.steamId : null;
        target.value = players.value.find(p => p.steamId === requestedSteamId)
            ?? players.value.find(p => p.steamId === me.value?.steamId)
            ?? (me.value.steamId ? { steamId: me.value.steamId, name: me.value.name, lastSeenAt: '' } : players.value[0] ?? null);
    }
    await loadSkins();
    await loadCollections();
    loading.value = false;
});
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
__VLS_asFunctionalElement1(__VLS_intrinsics.header, __VLS_intrinsics.header)({
    ...{ class: "page-header" },
});
/** @type {__VLS_StyleScopedClasses['page-header']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "eyebrow" },
});
/** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
if (__VLS_ctx.me?.isAdmin) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "target-picker" },
    });
    /** @type {__VLS_StyleScopedClasses['target-picker']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    let __VLS_0;
    /** @ts-ignore @type {typeof __VLS_components.Select | typeof __VLS_components.Select} */
    Select;
    // @ts-ignore
    const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
        ...{ 'onChange': {} },
        modelValue: (__VLS_ctx.target),
        options: (__VLS_ctx.players),
        optionLabel: "name",
        filter: true,
        placeholder: "Выберите игрока",
    }));
    const __VLS_2 = __VLS_1({
        ...{ 'onChange': {} },
        modelValue: (__VLS_ctx.target),
        options: (__VLS_ctx.players),
        optionLabel: "name",
        filter: true,
        placeholder: "Выберите игрока",
    }, ...__VLS_functionalComponentArgsRest(__VLS_1));
    let __VLS_5;
    const __VLS_6 = ({ change: {} },
        { onChange: (__VLS_ctx.retarget) });
    const { default: __VLS_7 } = __VLS_3.slots;
    {
        const { option: __VLS_8 } = __VLS_3.slots;
        const [{ option }] = __VLS_vSlot(__VLS_8);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (option.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "muted steamid" },
        });
        /** @type {__VLS_StyleScopedClasses['muted']} */ ;
        /** @type {__VLS_StyleScopedClasses['steamid']} */ ;
        (option.steamId);
        // @ts-ignore
        [me, target, players, retarget,];
    }
    // @ts-ignore
    [];
    var __VLS_3;
    var __VLS_4;
}
if (__VLS_ctx.profile) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "profile-card" },
    });
    /** @type {__VLS_StyleScopedClasses['profile-card']} */ ;
    if (__VLS_ctx.profile.avatarUrl) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
            src: (__VLS_ctx.profile.avatarUrl),
            alt: "",
        });
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "profile-main" },
    });
    /** @type {__VLS_StyleScopedClasses['profile-main']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    (__VLS_ctx.profile.name);
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.profile.steamId);
    __VLS_asFunctionalElement1(__VLS_intrinsics.a, __VLS_intrinsics.a)({
        ...{ class: "profile-steam" },
        href: (__VLS_ctx.profile.profileUrl || `https://steamcommunity.com/profiles/${__VLS_ctx.profile.steamId}`),
        target: "_blank",
    });
    /** @type {__VLS_StyleScopedClasses['profile-steam']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.i)({
        ...{ class: "pi pi-external-link" },
    });
    /** @type {__VLS_StyleScopedClasses['pi']} */ ;
    /** @type {__VLS_StyleScopedClasses['pi-external-link']} */ ;
    if (__VLS_ctx.profile.faceitElo) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.a, __VLS_intrinsics.a)({
            ...{ class: (['elo-badge', 'profile-elo', __VLS_ctx.profile.faceitNickname ? 'clickable' : '']) },
            href: (__VLS_ctx.profile.faceitNickname ? `https://www.faceit.com/ru/players/${__VLS_ctx.profile.faceitNickname}` : undefined),
            target: "_blank",
        });
        /** @type {__VLS_StyleScopedClasses['elo-badge']} */ ;
        /** @type {__VLS_StyleScopedClasses['profile-elo']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
            src: (`/faceit/lvl${__VLS_ctx.faceitLevel(__VLS_ctx.profile.faceitElo)}.svg`),
            ...{ class: "elo-level-img" },
            alt: (`Level ${__VLS_ctx.faceitLevel(__VLS_ctx.profile.faceitElo)}`),
        });
        /** @type {__VLS_StyleScopedClasses['elo-level-img']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (__VLS_ctx.profile.faceitElo);
    }
}
__VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
    ...{ class: "skinchanger-layout" },
});
/** @type {__VLS_StyleScopedClasses['skinchanger-layout']} */ ;
if (__VLS_ctx.editingSelf) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.aside, __VLS_intrinsics.aside)({
        ...{ class: "collections-panel" },
    });
    /** @type {__VLS_StyleScopedClasses['collections-panel']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    (__VLS_ctx.collections.length);
    for (const [item] of __VLS_vFor((__VLS_ctx.collections))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.editingSelf))
                        return;
                    __VLS_ctx.activateCollection(item);
                    // @ts-ignore
                    [profile, profile, profile, profile, profile, profile, profile, profile, profile, profile, profile, profile, profile, profile, faceitLevel, faceitLevel, editingSelf, collections, collections, activateCollection,];
                } },
            ...{ onKeydown: (...[$event]) => {
                    if (!(__VLS_ctx.editingSelf))
                        return;
                    __VLS_ctx.activateCollection(item);
                    // @ts-ignore
                    [activateCollection,];
                } },
            key: (item.id),
            ...{ class: "collection-item" },
            ...{ class: ({ active: item.active }) },
            role: "button",
            tabindex: "0",
        });
        /** @type {__VLS_StyleScopedClasses['collection-item']} */ ;
        /** @type {__VLS_StyleScopedClasses['active']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (item.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (item.count);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "collection-actions" },
        });
        /** @type {__VLS_StyleScopedClasses['collection-actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.editingSelf))
                        return;
                    __VLS_ctx.shareCollection(item);
                    // @ts-ignore
                    [shareCollection,];
                } },
            type: "button",
            ...{ class: "collection-action share" },
            title: "Поделиться",
        });
        /** @type {__VLS_StyleScopedClasses['collection-action']} */ ;
        /** @type {__VLS_StyleScopedClasses['share']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.i)({
            ...{ class: "pi pi-share-alt" },
        });
        /** @type {__VLS_StyleScopedClasses['pi']} */ ;
        /** @type {__VLS_StyleScopedClasses['pi-share-alt']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.editingSelf))
                        return;
                    __VLS_ctx.confirmDeleteCollection(item);
                    // @ts-ignore
                    [confirmDeleteCollection,];
                } },
            type: "button",
            ...{ class: "collection-action delete" },
            title: "Удалить коллекцию",
        });
        /** @type {__VLS_StyleScopedClasses['collection-action']} */ ;
        /** @type {__VLS_StyleScopedClasses['delete']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.i)({
            ...{ class: "pi pi-trash" },
        });
        /** @type {__VLS_StyleScopedClasses['pi']} */ ;
        /** @type {__VLS_StyleScopedClasses['pi-trash']} */ ;
        // @ts-ignore
        [];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "collections-buttons" },
    });
    /** @type {__VLS_StyleScopedClasses['collections-buttons']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.editingSelf))
                    return;
                __VLS_ctx.collectionDialog = true;
                // @ts-ignore
                [collectionDialog,];
            } },
        type: "button",
        ...{ class: "collection-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['collection-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.i)({
        ...{ class: "pi pi-plus" },
    });
    /** @type {__VLS_StyleScopedClasses['pi']} */ ;
    /** @type {__VLS_StyleScopedClasses['pi-plus']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.editingSelf))
                    return;
                __VLS_ctx.importDialog = true;
                // @ts-ignore
                [importDialog,];
            } },
        type: "button",
        ...{ class: "collection-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['collection-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.i)({
        ...{ class: "pi pi-download" },
    });
    /** @type {__VLS_StyleScopedClasses['pi']} */ ;
    /** @type {__VLS_StyleScopedClasses['pi-download']} */ ;
}
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "skinchanger-main" },
});
/** @type {__VLS_StyleScopedClasses['skinchanger-main']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
    ...{ class: "panel skin-toolbar" },
});
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['skin-toolbar']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "cat-tabs" },
});
/** @type {__VLS_StyleScopedClasses['cat-tabs']} */ ;
for (const [c] of __VLS_vFor((__VLS_ctx.categories))) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.category = c.id;
                // @ts-ignore
                [categories, category,];
            } },
        key: (c.id),
        type: "button",
        ...{ class: "cat-tab" },
        ...{ class: ({ active: __VLS_ctx.category === c.id }) },
    });
    /** @type {__VLS_StyleScopedClasses['cat-tab']} */ ;
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    (c.label);
    // @ts-ignore
    [category,];
}
let __VLS_9;
/** @ts-ignore @type {typeof __VLS_components.InputText} */
InputText;
// @ts-ignore
const __VLS_10 = __VLS_asFunctionalComponent1(__VLS_9, new __VLS_9({
    modelValue: (__VLS_ctx.search),
    placeholder: "Поиск...",
    ...{ class: "skin-search" },
}));
const __VLS_11 = __VLS_10({
    modelValue: (__VLS_ctx.search),
    placeholder: "Поиск...",
    ...{ class: "skin-search" },
}, ...__VLS_functionalComponentArgsRest(__VLS_10));
/** @type {__VLS_StyleScopedClasses['skin-search']} */ ;
if (__VLS_ctx.me?.isAdmin && !__VLS_ctx.target) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "muted" },
    });
    /** @type {__VLS_StyleScopedClasses['muted']} */ ;
}
else {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "weapon-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['weapon-grid']} */ ;
    for (const [w] of __VLS_vFor((__VLS_ctx.visibleWeapons))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.me?.isAdmin && !__VLS_ctx.target))
                        return;
                    __VLS_ctx.openWeapon(w);
                    // @ts-ignore
                    [me, target, search, visibleWeapons, openWeapon,];
                } },
            key: (w.weapon),
            type: "button",
            ...{ class: "weapon-card" },
            ...{ style: ({ '--rarity': __VLS_ctx.currentSkin(w.weapon)?.color ?? '#30343d' }) },
        });
        /** @type {__VLS_StyleScopedClasses['weapon-card']} */ ;
        if (__VLS_ctx.currentSkin(w.weapon)) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.span)({
                ...{ class: "rarity-dot" },
                ...{ style: ({ background: __VLS_ctx.currentSkin(w.weapon).color }) },
            });
            /** @type {__VLS_StyleScopedClasses['rarity-dot']} */ ;
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
            src: (__VLS_ctx.currentSkin(w.weapon)?.image || w.image),
            alt: (w.name),
            loading: "lazy",
            ...{ class: ({ vanilla: !__VLS_ctx.currentSkin(w.weapon) }) },
        });
        /** @type {__VLS_StyleScopedClasses['vanilla']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "weapon-title" },
        });
        /** @type {__VLS_StyleScopedClasses['weapon-title']} */ ;
        (w.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "skin-title" },
            ...{ class: ({ muted: !__VLS_ctx.currentSkin(w.weapon) }) },
        });
        /** @type {__VLS_StyleScopedClasses['skin-title']} */ ;
        /** @type {__VLS_StyleScopedClasses['muted']} */ ;
        (__VLS_ctx.currentSkin(w.weapon)?.name.split('| ')[1] ?? 'Добавить скин');
        // @ts-ignore
        [currentSkin, currentSkin, currentSkin, currentSkin, currentSkin, currentSkin, currentSkin,];
    }
}
let __VLS_14;
/** @ts-ignore @type {typeof __VLS_components.Dialog | typeof __VLS_components.Dialog} */
Dialog;
// @ts-ignore
const __VLS_15 = __VLS_asFunctionalComponent1(__VLS_14, new __VLS_14({
    visible: (__VLS_ctx.collectionDialog),
    modal: true,
    header: "Новая коллекция",
    ...{ style: ({ width: '28rem' }) },
}));
const __VLS_16 = __VLS_15({
    visible: (__VLS_ctx.collectionDialog),
    modal: true,
    header: "Новая коллекция",
    ...{ style: ({ width: '28rem' }) },
}, ...__VLS_functionalComponentArgsRest(__VLS_15));
const { default: __VLS_19 } = __VLS_17.slots;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "field" },
});
/** @type {__VLS_StyleScopedClasses['field']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
let __VLS_20;
/** @ts-ignore @type {typeof __VLS_components.InputText} */
InputText;
// @ts-ignore
const __VLS_21 = __VLS_asFunctionalComponent1(__VLS_20, new __VLS_20({
    modelValue: (__VLS_ctx.collectionName),
    maxlength: "48",
    placeholder: "Например, Competitive",
    autofocus: true,
}));
const __VLS_22 = __VLS_21({
    modelValue: (__VLS_ctx.collectionName),
    maxlength: "48",
    placeholder: "Например, Competitive",
    autofocus: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_21));
{
    const { footer: __VLS_25 } = __VLS_17.slots;
    let __VLS_26;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_27 = __VLS_asFunctionalComponent1(__VLS_26, new __VLS_26({
        ...{ 'onClick': {} },
        label: "Отмена",
        text: true,
    }));
    const __VLS_28 = __VLS_27({
        ...{ 'onClick': {} },
        label: "Отмена",
        text: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_27));
    let __VLS_31;
    const __VLS_32 = ({ click: {} },
        { onClick: (...[$event]) => {
                __VLS_ctx.collectionDialog = false;
                // @ts-ignore
                [collectionDialog, collectionDialog, collectionName,];
            } });
    var __VLS_29;
    var __VLS_30;
    let __VLS_33;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_34 = __VLS_asFunctionalComponent1(__VLS_33, new __VLS_33({
        ...{ 'onClick': {} },
        label: "Создать",
        icon: "pi pi-plus",
    }));
    const __VLS_35 = __VLS_34({
        ...{ 'onClick': {} },
        label: "Создать",
        icon: "pi pi-plus",
    }, ...__VLS_functionalComponentArgsRest(__VLS_34));
    let __VLS_38;
    const __VLS_39 = ({ click: {} },
        { onClick: (__VLS_ctx.createCollection) });
    var __VLS_36;
    var __VLS_37;
    // @ts-ignore
    [createCollection,];
}
// @ts-ignore
[];
var __VLS_17;
let __VLS_40;
/** @ts-ignore @type {typeof __VLS_components.Dialog | typeof __VLS_components.Dialog} */
Dialog;
// @ts-ignore
const __VLS_41 = __VLS_asFunctionalComponent1(__VLS_40, new __VLS_40({
    visible: (__VLS_ctx.importDialog),
    modal: true,
    header: "Импорт коллекции",
    ...{ style: ({ width: '28rem' }) },
}));
const __VLS_42 = __VLS_41({
    visible: (__VLS_ctx.importDialog),
    modal: true,
    header: "Импорт коллекции",
    ...{ style: ({ width: '28rem' }) },
}, ...__VLS_functionalComponentArgsRest(__VLS_41));
const { default: __VLS_45 } = __VLS_43.slots;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "field" },
    ...{ style: {} },
});
/** @type {__VLS_StyleScopedClasses['field']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
    ...{ class: "p-inputtext" },
    ...{ style: {} },
    rows: "6",
    value: (__VLS_ctx.importCode),
    placeholder: "Вставьте код...",
    autofocus: true,
});
/** @type {__VLS_StyleScopedClasses['p-inputtext']} */ ;
{
    const { footer: __VLS_46 } = __VLS_43.slots;
    let __VLS_47;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_48 = __VLS_asFunctionalComponent1(__VLS_47, new __VLS_47({
        ...{ 'onClick': {} },
        label: "Отмена",
        text: true,
    }));
    const __VLS_49 = __VLS_48({
        ...{ 'onClick': {} },
        label: "Отмена",
        text: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_48));
    let __VLS_52;
    const __VLS_53 = ({ click: {} },
        { onClick: (...[$event]) => {
                __VLS_ctx.importDialog = false;
                // @ts-ignore
                [importDialog, importDialog, importCode,];
            } });
    var __VLS_50;
    var __VLS_51;
    let __VLS_54;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_55 = __VLS_asFunctionalComponent1(__VLS_54, new __VLS_54({
        ...{ 'onClick': {} },
        label: "Импортировать",
        icon: "pi pi-download",
    }));
    const __VLS_56 = __VLS_55({
        ...{ 'onClick': {} },
        label: "Импортировать",
        icon: "pi pi-download",
    }, ...__VLS_functionalComponentArgsRest(__VLS_55));
    let __VLS_59;
    const __VLS_60 = ({ click: {} },
        { onClick: (__VLS_ctx.importCollection) });
    var __VLS_57;
    var __VLS_58;
    // @ts-ignore
    [importCollection,];
}
// @ts-ignore
[];
var __VLS_43;
let __VLS_61;
/** @ts-ignore @type {typeof __VLS_components.Dialog | typeof __VLS_components.Dialog} */
Dialog;
// @ts-ignore
const __VLS_62 = __VLS_asFunctionalComponent1(__VLS_61, new __VLS_61({
    visible: (__VLS_ctx.dialog),
    modal: true,
    header: (__VLS_ctx.dialogWeapon?.name ?? ''),
    ...{ class: "skin-dialog" },
    ...{ style: ({ width: 'min(1080px, 96vw)' }) },
}));
const __VLS_63 = __VLS_62({
    visible: (__VLS_ctx.dialog),
    modal: true,
    header: (__VLS_ctx.dialogWeapon?.name ?? ''),
    ...{ class: "skin-dialog" },
    ...{ style: ({ width: 'min(1080px, 96vw)' }) },
}, ...__VLS_functionalComponentArgsRest(__VLS_62));
/** @type {__VLS_StyleScopedClasses['skin-dialog']} */ ;
const { default: __VLS_66 } = __VLS_64.slots;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "dialog-toolbar" },
});
/** @type {__VLS_StyleScopedClasses['dialog-toolbar']} */ ;
let __VLS_67;
/** @ts-ignore @type {typeof __VLS_components.InputText} */
InputText;
// @ts-ignore
const __VLS_68 = __VLS_asFunctionalComponent1(__VLS_67, new __VLS_67({
    modelValue: (__VLS_ctx.dialogSearch),
    placeholder: "Поиск скина...",
    autofocus: true,
}));
const __VLS_69 = __VLS_68({
    modelValue: (__VLS_ctx.dialogSearch),
    placeholder: "Поиск скина...",
    autofocus: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_68));
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "wear-seed" },
});
/** @type {__VLS_StyleScopedClasses['wear-seed']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "wear-box" },
});
/** @type {__VLS_StyleScopedClasses['wear-box']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
(__VLS_ctx.wear.toFixed(4));
let __VLS_72;
/** @ts-ignore @type {typeof __VLS_components.Slider} */
Slider;
// @ts-ignore
const __VLS_73 = __VLS_asFunctionalComponent1(__VLS_72, new __VLS_72({
    ...{ 'onUpdate:modelValue': {} },
    modelValue: (__VLS_ctx.wear),
    min: (__VLS_ctx.picked?.minWear ?? 0),
    max: (__VLS_ctx.picked?.maxWear ?? 1),
    step: (0.0001),
}));
const __VLS_74 = __VLS_73({
    ...{ 'onUpdate:modelValue': {} },
    modelValue: (__VLS_ctx.wear),
    min: (__VLS_ctx.picked?.minWear ?? 0),
    max: (__VLS_ctx.picked?.maxWear ?? 1),
    step: (0.0001),
}, ...__VLS_functionalComponentArgsRest(__VLS_73));
let __VLS_77;
const __VLS_78 = ({ 'update:modelValue': {} },
    { 'onUpdate:modelValue': (v => __VLS_ctx.wear = Array.isArray(v) ? v[0] : v) });
var __VLS_75;
var __VLS_76;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "seed-box" },
});
/** @type {__VLS_StyleScopedClasses['seed-box']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
let __VLS_79;
/** @ts-ignore @type {typeof __VLS_components.InputNumber} */
InputNumber;
// @ts-ignore
const __VLS_80 = __VLS_asFunctionalComponent1(__VLS_79, new __VLS_79({
    modelValue: (__VLS_ctx.seed),
    min: (0),
    max: (1000),
    showButtons: true,
}));
const __VLS_81 = __VLS_80({
    modelValue: (__VLS_ctx.seed),
    min: (0),
    max: (1000),
    showButtons: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_80));
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "skin-grid" },
});
/** @type {__VLS_StyleScopedClasses['skin-grid']} */ ;
for (const [s] of __VLS_vFor((__VLS_ctx.dialogSkins))) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.pick(s);
                // @ts-ignore
                [dialog, dialogWeapon, dialogSearch, wear, wear, wear, picked, picked, seed, dialogSkins, pick,];
            } },
        key: (s.paint),
        type: "button",
        ...{ class: "skin-card" },
        ...{ class: ({ selected: __VLS_ctx.picked?.paint === s.paint }) },
        ...{ style: ({ '--rarity': s.color }) },
    });
    /** @type {__VLS_StyleScopedClasses['skin-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['selected']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
        src: (s.image),
        alt: (s.name),
        loading: "lazy",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (s.name.split('| ')[1] ?? s.name);
    // @ts-ignore
    [picked,];
}
{
    const { footer: __VLS_84 } = __VLS_64.slots;
    let __VLS_85;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_86 = __VLS_asFunctionalComponent1(__VLS_85, new __VLS_85({
        ...{ 'onClick': {} },
        label: "Сбросить скин",
        severity: "danger",
        text: true,
        disabled: (!__VLS_ctx.dialogWeapon || !__VLS_ctx.mySkins[__VLS_ctx.dialogWeapon.weapon]),
        loading: (__VLS_ctx.saving),
    }));
    const __VLS_87 = __VLS_86({
        ...{ 'onClick': {} },
        label: "Сбросить скин",
        severity: "danger",
        text: true,
        disabled: (!__VLS_ctx.dialogWeapon || !__VLS_ctx.mySkins[__VLS_ctx.dialogWeapon.weapon]),
        loading: (__VLS_ctx.saving),
    }, ...__VLS_functionalComponentArgsRest(__VLS_86));
    let __VLS_90;
    const __VLS_91 = ({ click: {} },
        { onClick: (__VLS_ctx.resetSkin) });
    var __VLS_88;
    var __VLS_89;
    let __VLS_92;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_93 = __VLS_asFunctionalComponent1(__VLS_92, new __VLS_92({
        ...{ 'onClick': {} },
        label: "Отмена",
        text: true,
    }));
    const __VLS_94 = __VLS_93({
        ...{ 'onClick': {} },
        label: "Отмена",
        text: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_93));
    let __VLS_97;
    const __VLS_98 = ({ click: {} },
        { onClick: (...[$event]) => {
                __VLS_ctx.dialog = false;
                // @ts-ignore
                [dialog, dialogWeapon, dialogWeapon, mySkins, saving, resetSkin,];
            } });
    var __VLS_95;
    var __VLS_96;
    let __VLS_99;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_100 = __VLS_asFunctionalComponent1(__VLS_99, new __VLS_99({
        ...{ 'onClick': {} },
        label: "Сохранить",
        icon: "pi pi-check",
        disabled: (!__VLS_ctx.picked),
        loading: (__VLS_ctx.saving),
    }));
    const __VLS_101 = __VLS_100({
        ...{ 'onClick': {} },
        label: "Сохранить",
        icon: "pi pi-check",
        disabled: (!__VLS_ctx.picked),
        loading: (__VLS_ctx.saving),
    }, ...__VLS_functionalComponentArgsRest(__VLS_100));
    let __VLS_104;
    const __VLS_105 = ({ click: {} },
        { onClick: (__VLS_ctx.save) });
    var __VLS_102;
    var __VLS_103;
    // @ts-ignore
    [picked, saving, save,];
}
// @ts-ignore
[];
var __VLS_64;
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
