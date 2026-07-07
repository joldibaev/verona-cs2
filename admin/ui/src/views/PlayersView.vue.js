import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Avatar from 'primevue/avatar';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { api } from '../api';
import { faceitLevel } from '../faceit';
const players = ref([]);
const router = useRouter();
const confirm = useConfirm();
const toast = useToast();
const roles = [{ label: 'Игрок', value: 'player' }, { label: 'Администратор', value: 'admin' }];
const onlineCount = computed(() => players.value.filter(p => p.online).length);
const search = ref('');
const filteredPlayers = computed(() => { const q = search.value.trim().toLowerCase(); return q ? players.value.filter(p => p.name.toLowerCase().includes(q) || p.steamId.includes(q)) : players.value; });
async function load() { players.value = await api('/api/players'); }
async function changeRole(player, role) {
    try {
        await api(`/api/players/${player.steamId}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
        toast.add({ severity: 'success', summary: 'Роль обновлена', life: 2200 });
        await load();
    }
    catch (error) {
        toast.add({ severity: 'error', summary: 'Роль не изменена', detail: String(error), life: 4000 });
        await load();
    }
}
function kick(player) {
    confirm.require({ message: `Кикнуть ${player.name}?`, header: 'Подтверждение', acceptLabel: 'Кикнуть', rejectLabel: 'Отмена',
        accept: async () => { await api(`/api/players/${player.steamId}/kick`, { method: 'POST', body: JSON.stringify({ type: 'kick', reason: 'Removed by admin' }) }); toast.add({ severity: 'success', summary: 'Команда отправлена', life: 2200 }); } });
}
function toggleBan(player) {
    const action = player.banned ? 'Разбанить' : 'Забанить навсегда';
    confirm.require({ message: `${action} ${player.name}?`, header: 'Блокировка', acceptLabel: action, rejectLabel: 'Отмена', acceptClass: player.banned ? '' : 'p-button-danger',
        accept: async () => {
            if (player.banned)
                await api(`/api/players/${player.steamId}/ban`, { method: 'DELETE' });
            else
                await api(`/api/players/${player.steamId}/ban`, { method: 'POST', body: JSON.stringify({ reason: 'Banned by admin', durationMinutes: null }) });
            toast.add({ severity: 'success', summary: player.banned ? 'Игрок разбанен' : 'Игрок забанен', life: 2200 });
            await load();
        } });
}
function skins(player) { router.push({ path: '/skinchanger', query: { steamId: player.steamId } }); }
let timer = 0;
onMounted(async () => { await load(); timer = window.setInterval(load, 5000); });
onUnmounted(() => clearInterval(timer));
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
__VLS_asFunctionalElement1(__VLS_intrinsics.header, __VLS_intrinsics.header)({
    ...{ class: "page-header players-head" },
});
/** @type {__VLS_StyleScopedClasses['page-header']} */ ;
/** @type {__VLS_StyleScopedClasses['players-head']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "eyebrow" },
});
/** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
    ...{ class: "muted" },
});
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
(__VLS_ctx.players.length);
(__VLS_ctx.onlineCount);
__VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
    ...{ class: "player-search" },
});
/** @type {__VLS_StyleScopedClasses['player-search']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.i)({
    ...{ class: "pi pi-search" },
    'aria-hidden': "true",
});
/** @type {__VLS_StyleScopedClasses['pi']} */ ;
/** @type {__VLS_StyleScopedClasses['pi-search']} */ ;
let __VLS_0;
/** @ts-ignore @type {typeof __VLS_components.InputText} */
InputText;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
    modelValue: (__VLS_ctx.search),
    placeholder: "Имя или SteamID",
}));
const __VLS_2 = __VLS_1({
    modelValue: (__VLS_ctx.search),
    placeholder: "Имя или SteamID",
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
    ...{ class: "panel table-panel" },
});
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['table-panel']} */ ;
let __VLS_5;
/** @ts-ignore @type {typeof __VLS_components.DataTable | typeof __VLS_components.DataTable} */
DataTable;
// @ts-ignore
const __VLS_6 = __VLS_asFunctionalComponent1(__VLS_5, new __VLS_5({
    value: (__VLS_ctx.filteredPlayers),
    dataKey: "steamId",
    paginator: true,
    rows: (20),
    rowsPerPageOptions: ([20, 50, 100]),
    ...{ class: "players-table" },
}));
const __VLS_7 = __VLS_6({
    value: (__VLS_ctx.filteredPlayers),
    dataKey: "steamId",
    paginator: true,
    rows: (20),
    rowsPerPageOptions: ([20, 50, 100]),
    ...{ class: "players-table" },
}, ...__VLS_functionalComponentArgsRest(__VLS_6));
/** @type {__VLS_StyleScopedClasses['players-table']} */ ;
const { default: __VLS_10 } = __VLS_8.slots;
{
    const { empty: __VLS_11 } = __VLS_8.slots;
    // @ts-ignore
    [players, onlineCount, search, filteredPlayers,];
}
let __VLS_12;
/** @ts-ignore @type {typeof __VLS_components.Column | typeof __VLS_components.Column} */
Column;
// @ts-ignore
const __VLS_13 = __VLS_asFunctionalComponent1(__VLS_12, new __VLS_12({
    header: "Игрок",
    sortable: true,
    sortField: "name",
}));
const __VLS_14 = __VLS_13({
    header: "Игрок",
    sortable: true,
    sortField: "name",
}, ...__VLS_functionalComponentArgsRest(__VLS_13));
const { default: __VLS_17 } = __VLS_15.slots;
{
    const { body: __VLS_18 } = __VLS_15.slots;
    const [{ data }] = __VLS_vSlot(__VLS_18);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "player-cell" },
    });
    /** @type {__VLS_StyleScopedClasses['player-cell']} */ ;
    let __VLS_19;
    /** @ts-ignore @type {typeof __VLS_components.Avatar} */
    Avatar;
    // @ts-ignore
    const __VLS_20 = __VLS_asFunctionalComponent1(__VLS_19, new __VLS_19({
        image: (data.avatarUrl || undefined),
        label: (data.avatarUrl ? undefined : data.name.slice(0, 1)),
        shape: "circle",
        size: "large",
    }));
    const __VLS_21 = __VLS_20({
        image: (data.avatarUrl || undefined),
        label: (data.avatarUrl ? undefined : data.name.slice(0, 1)),
        shape: "circle",
        size: "large",
    }, ...__VLS_functionalComponentArgsRest(__VLS_20));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.a, __VLS_intrinsics.a)({
        href: (data.profileUrl || `https://steamcommunity.com/profiles/${data.steamId}`),
        target: "_blank",
    });
    (data.name);
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    (data.steamId);
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_15;
let __VLS_24;
/** @ts-ignore @type {typeof __VLS_components.Column | typeof __VLS_components.Column} */
Column;
// @ts-ignore
const __VLS_25 = __VLS_asFunctionalComponent1(__VLS_24, new __VLS_24({
    header: "Статус",
}));
const __VLS_26 = __VLS_25({
    header: "Статус",
}, ...__VLS_functionalComponentArgsRest(__VLS_25));
const { default: __VLS_29 } = __VLS_27.slots;
{
    const { body: __VLS_30 } = __VLS_27.slots;
    const [{ data }] = __VLS_vSlot(__VLS_30);
    let __VLS_31;
    /** @ts-ignore @type {typeof __VLS_components.Tag} */
    Tag;
    // @ts-ignore
    const __VLS_32 = __VLS_asFunctionalComponent1(__VLS_31, new __VLS_31({
        value: (data.online ? 'Онлайн' : 'Не в сети'),
        severity: (data.online ? 'success' : 'secondary'),
    }));
    const __VLS_33 = __VLS_32({
        value: (data.online ? 'Онлайн' : 'Не в сети'),
        severity: (data.online ? 'success' : 'secondary'),
    }, ...__VLS_functionalComponentArgsRest(__VLS_32));
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_27;
let __VLS_36;
/** @ts-ignore @type {typeof __VLS_components.Column | typeof __VLS_components.Column} */
Column;
// @ts-ignore
const __VLS_37 = __VLS_asFunctionalComponent1(__VLS_36, new __VLS_36({
    header: "FACEIT",
}));
const __VLS_38 = __VLS_37({
    header: "FACEIT",
}, ...__VLS_functionalComponentArgsRest(__VLS_37));
const { default: __VLS_41 } = __VLS_39.slots;
{
    const { body: __VLS_42 } = __VLS_39.slots;
    const [{ data }] = __VLS_vSlot(__VLS_42);
    if (data.faceitElo) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "elo-badge row-elo" },
        });
        /** @type {__VLS_StyleScopedClasses['elo-badge']} */ ;
        /** @type {__VLS_StyleScopedClasses['row-elo']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
            src: (`/faceit/lvl${__VLS_ctx.faceitLevel(data.faceitElo)}.svg`),
            ...{ class: "elo-level-img" },
            alt: (`Level ${__VLS_ctx.faceitLevel(data.faceitElo)}`),
        });
        /** @type {__VLS_StyleScopedClasses['elo-level-img']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (data.faceitElo);
    }
    else {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "muted" },
        });
        /** @type {__VLS_StyleScopedClasses['muted']} */ ;
    }
    // @ts-ignore
    [faceitLevel, faceitLevel,];
}
// @ts-ignore
[];
var __VLS_39;
let __VLS_43;
/** @ts-ignore @type {typeof __VLS_components.Column | typeof __VLS_components.Column} */
Column;
// @ts-ignore
const __VLS_44 = __VLS_asFunctionalComponent1(__VLS_43, new __VLS_43({
    header: "Роль",
}));
const __VLS_45 = __VLS_44({
    header: "Роль",
}, ...__VLS_functionalComponentArgsRest(__VLS_44));
const { default: __VLS_48 } = __VLS_46.slots;
{
    const { body: __VLS_49 } = __VLS_46.slots;
    const [{ data }] = __VLS_vSlot(__VLS_49);
    let __VLS_50;
    /** @ts-ignore @type {typeof __VLS_components.Select} */
    Select;
    // @ts-ignore
    const __VLS_51 = __VLS_asFunctionalComponent1(__VLS_50, new __VLS_50({
        ...{ 'onUpdate:modelValue': {} },
        modelValue: (data.role),
        options: (__VLS_ctx.roles),
        optionLabel: "label",
        optionValue: "value",
    }));
    const __VLS_52 = __VLS_51({
        ...{ 'onUpdate:modelValue': {} },
        modelValue: (data.role),
        options: (__VLS_ctx.roles),
        optionLabel: "label",
        optionValue: "value",
    }, ...__VLS_functionalComponentArgsRest(__VLS_51));
    let __VLS_55;
    const __VLS_56 = ({ 'update:modelValue': {} },
        { 'onUpdate:modelValue': (...[$event]) => {
                __VLS_ctx.changeRole(data, $event);
                // @ts-ignore
                [roles, changeRole,];
            } });
    var __VLS_53;
    var __VLS_54;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_46;
let __VLS_57;
/** @ts-ignore @type {typeof __VLS_components.Column | typeof __VLS_components.Column} */
Column;
// @ts-ignore
const __VLS_58 = __VLS_asFunctionalComponent1(__VLS_57, new __VLS_57({
    header: "Бан",
}));
const __VLS_59 = __VLS_58({
    header: "Бан",
}, ...__VLS_functionalComponentArgsRest(__VLS_58));
const { default: __VLS_62 } = __VLS_60.slots;
{
    const { body: __VLS_63 } = __VLS_60.slots;
    const [{ data }] = __VLS_vSlot(__VLS_63);
    if (data.banned) {
        let __VLS_64;
        /** @ts-ignore @type {typeof __VLS_components.Tag} */
        Tag;
        // @ts-ignore
        const __VLS_65 = __VLS_asFunctionalComponent1(__VLS_64, new __VLS_64({
            value: "Забанен",
            severity: "danger",
        }));
        const __VLS_66 = __VLS_65({
            value: "Забанен",
            severity: "danger",
        }, ...__VLS_functionalComponentArgsRest(__VLS_65));
    }
    else {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "muted" },
        });
        /** @type {__VLS_StyleScopedClasses['muted']} */ ;
    }
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_60;
let __VLS_69;
/** @ts-ignore @type {typeof __VLS_components.Column | typeof __VLS_components.Column} */
Column;
// @ts-ignore
const __VLS_70 = __VLS_asFunctionalComponent1(__VLS_69, new __VLS_69({
    header: "Последний визит",
    sortable: true,
    sortField: "lastSeenAt",
}));
const __VLS_71 = __VLS_70({
    header: "Последний визит",
    sortable: true,
    sortField: "lastSeenAt",
}, ...__VLS_functionalComponentArgsRest(__VLS_70));
const { default: __VLS_74 } = __VLS_72.slots;
{
    const { body: __VLS_75 } = __VLS_72.slots;
    const [{ data }] = __VLS_vSlot(__VLS_75);
    (new Date(data.lastSeenAt).toLocaleString('ru-RU'));
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_72;
let __VLS_76;
/** @ts-ignore @type {typeof __VLS_components.Column | typeof __VLS_components.Column} */
Column;
// @ts-ignore
const __VLS_77 = __VLS_asFunctionalComponent1(__VLS_76, new __VLS_76({
    header: "Действия",
}));
const __VLS_78 = __VLS_77({
    header: "Действия",
}, ...__VLS_functionalComponentArgsRest(__VLS_77));
const { default: __VLS_81 } = __VLS_79.slots;
{
    const { body: __VLS_82 } = __VLS_79.slots;
    const [{ data }] = __VLS_vSlot(__VLS_82);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "row-actions" },
    });
    /** @type {__VLS_StyleScopedClasses['row-actions']} */ ;
    let __VLS_83;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_84 = __VLS_asFunctionalComponent1(__VLS_83, new __VLS_83({
        ...{ 'onClick': {} },
        icon: "pi pi-palette",
        rounded: true,
        text: true,
    }));
    const __VLS_85 = __VLS_84({
        ...{ 'onClick': {} },
        icon: "pi pi-palette",
        rounded: true,
        text: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_84));
    let __VLS_88;
    const __VLS_89 = ({ click: {} },
        { onClick: (...[$event]) => {
                __VLS_ctx.skins(data);
                // @ts-ignore
                [skins,];
            } });
    __VLS_asFunctionalDirective(__VLS_directives.vTooltip, {})(null, { ...__VLS_directiveBindingRestFields, modifiers: { top: true, }, value: ('Скины') }, null, null);
    var __VLS_86;
    var __VLS_87;
    let __VLS_90;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_91 = __VLS_asFunctionalComponent1(__VLS_90, new __VLS_90({
        ...{ 'onClick': {} },
        icon: "pi pi-sign-out",
        rounded: true,
        text: true,
        severity: "warn",
        disabled: (!data.online),
    }));
    const __VLS_92 = __VLS_91({
        ...{ 'onClick': {} },
        icon: "pi pi-sign-out",
        rounded: true,
        text: true,
        severity: "warn",
        disabled: (!data.online),
    }, ...__VLS_functionalComponentArgsRest(__VLS_91));
    let __VLS_95;
    const __VLS_96 = ({ click: {} },
        { onClick: (...[$event]) => {
                __VLS_ctx.kick(data);
                // @ts-ignore
                [vTooltip, kick,];
            } });
    __VLS_asFunctionalDirective(__VLS_directives.vTooltip, {})(null, { ...__VLS_directiveBindingRestFields, modifiers: { top: true, }, value: ('Кикнуть') }, null, null);
    var __VLS_93;
    var __VLS_94;
    let __VLS_97;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_98 = __VLS_asFunctionalComponent1(__VLS_97, new __VLS_97({
        ...{ 'onClick': {} },
        icon: (data.banned ? 'pi pi-lock-open' : 'pi pi-ban'),
        rounded: true,
        text: true,
        severity: (data.banned ? 'secondary' : 'danger'),
    }));
    const __VLS_99 = __VLS_98({
        ...{ 'onClick': {} },
        icon: (data.banned ? 'pi pi-lock-open' : 'pi pi-ban'),
        rounded: true,
        text: true,
        severity: (data.banned ? 'secondary' : 'danger'),
    }, ...__VLS_functionalComponentArgsRest(__VLS_98));
    let __VLS_102;
    const __VLS_103 = ({ click: {} },
        { onClick: (...[$event]) => {
                __VLS_ctx.toggleBan(data);
                // @ts-ignore
                [vTooltip, toggleBan,];
            } });
    __VLS_asFunctionalDirective(__VLS_directives.vTooltip, {})(null, { ...__VLS_directiveBindingRestFields, modifiers: { top: true, }, value: (data.banned ? 'Разбанить' : 'Забанить') }, null, null);
    var __VLS_100;
    var __VLS_101;
    // @ts-ignore
    [vTooltip,];
}
// @ts-ignore
[];
var __VLS_79;
// @ts-ignore
[];
var __VLS_8;
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
