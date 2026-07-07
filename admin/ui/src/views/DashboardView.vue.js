import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { HubConnectionBuilder } from '@microsoft/signalr';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import Slider from 'primevue/slider';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { useToast } from 'primevue/usetoast';
import { api } from '../api';
const mapNames = {
    de_dust2: 'Dust II', de_mirage: 'Mirage', de_inferno: 'Inferno', de_nuke: 'Nuke',
    de_ancient: 'Ancient', de_anubis: 'Anubis', de_train: 'Train', de_overpass: 'Overpass', de_vertigo: 'Vertigo'
};
const activeDuty = ['de_dust2', 'de_mirage', 'de_inferno', 'de_nuke', 'de_ancient', 'de_anubis', 'de_train', 'de_overpass', 'de_vertigo'];
// Wingman uses its own official pool: the big maps have no 2v2 layout.
const wingman = ['de_inferno', 'de_nuke', 'de_overpass', 'de_vertigo'];
const modes = [
    { label: 'Casual', hint: 'Обычный: без ограничений, свободный вход', gameType: 0, gameMode: 0, maps: activeDuty },
    { label: 'Competitive', hint: 'Соревновательный: 5×5, MR24', gameType: 0, gameMode: 1, maps: activeDuty },
    { label: 'Wingman', hint: 'Напарники: 2×2, укороченные карты', gameType: 0, gameMode: 2, maps: wingman },
    { label: 'Deathmatch', hint: 'Deathmatch: мгновенное возрождение', gameType: 1, gameMode: 2, maps: activeDuty }
];
const mapSources = [{ label: 'Официальные', value: 'official' }, { label: 'Мастерская', value: 'workshop' }];
const difficulties = [
    { label: 'Лёгкие', value: 0 }, { label: 'Средние', value: 1 },
    { label: 'Сложные', value: 2 }, { label: 'Эксперт', value: 3 }
];
const status = ref(null);
const busy = ref(false);
const mode = ref(modes[0]);
const map = ref('de_dust2');
const mapSource = ref('official');
const workshopId = ref('');
const maxPlayers = ref(10);
const vac = ref(true);
const friendlyFire = ref(false);
const botsEnabled = ref(true);
const botQuota = ref(5);
const botDifficulty = ref(1);
const practice = ref(false);
const infiniteAmmo = ref(false);
const toast = useToast();
const phaseLabel = computed(() => status.value?.phase === 'ready' ? 'Сервер готов' : status.value?.phase === 'starting' ? 'Сервер запускается' : 'Сервер остановлен');
const phaseSeverity = computed(() => status.value?.phase === 'ready' ? 'success' : status.value?.phase === 'starting' ? 'warn' : 'danger');
const displayMap = computed(() => status.value?.ready && status.value.currentMap !== 'unknown' ? status.value.currentMap : map.value);
const displayMapName = computed(() => mapNames[displayMap.value] ?? displayMap.value);
async function load() {
    status.value = await api('/api/server/status');
}
async function copyAddress() {
    await navigator.clipboard.writeText('localhost:27015');
    toast.add({ severity: 'success', summary: 'Адрес скопирован', detail: 'localhost:27015', life: 1800 });
}
async function loadLaunch() {
    const launch = await api('/api/server/launch');
    mode.value = modes.find(m => m.gameType === launch.gameType && m.gameMode === launch.gameMode) ?? modes[0];
    map.value = mode.value.maps.includes(launch.map) ? launch.map : mode.value.maps[0];
    workshopId.value = launch.workshopMapId;
    mapSource.value = launch.workshopMapId ? 'workshop' : 'official';
    maxPlayers.value = launch.maxPlayers;
    vac.value = !launch.insecure;
    botsEnabled.value = launch.botsEnabled;
    botQuota.value = launch.botQuota;
    botDifficulty.value = launch.botDifficulty;
    practice.value = launch.practice;
    infiniteAmmo.value = launch.infiniteAmmo;
    friendlyFire.value = launch.friendlyFire;
}
watch(mode, m => { if (!m.maps.includes(map.value))
    map.value = m.maps[0]; });
// Cheats-based options cannot work while VAC is active: drop it automatically.
watch([practice, infiniteAmmo], ([p, ammo]) => { if (p || ammo)
    vac.value = false; });
async function action(name) {
    if (name === 'start' && mapSource.value === 'workshop' && !/^\d{1,20}$/.test(workshopId.value.trim())) {
        toast.add({ severity: 'warn', summary: 'Мастерская', detail: 'Укажите числовой ID карты из Steam Workshop', life: 4000 });
        return;
    }
    busy.value = true;
    try {
        const body = name === 'start'
            ? JSON.stringify({
                map: mapSource.value === 'official' ? map.value : null,
                workshopMapId: mapSource.value === 'workshop' ? workshopId.value.trim() : '',
                gameType: mode.value.gameType, gameMode: mode.value.gameMode,
                maxPlayers: maxPlayers.value, insecure: !vac.value,
                botsEnabled: botsEnabled.value, botQuota: botQuota.value, botDifficulty: botDifficulty.value,
                practice: practice.value, infiniteAmmo: infiniteAmmo.value, friendlyFire: friendlyFire.value
            })
            : undefined;
        await api(`/api/server/${name}`, { method: 'POST', body });
        await new Promise(r => setTimeout(r, 300));
        await load();
    }
    catch (e) {
        toast.add({ severity: 'error', summary: 'Ошибка', detail: String(e), life: 4000 });
    }
    finally {
        busy.value = false;
    }
}
let timer = 0;
const hub = new HubConnectionBuilder().withUrl('/hub').withAutomaticReconnect().build();
onMounted(async () => { await load(); await loadLaunch(); timer = window.setInterval(load, 2000); hub.on('serverChanged', load); await hub.start().catch(() => { }); });
onUnmounted(() => { clearInterval(timer); void hub.stop(); });
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
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
    ...{ class: "muted" },
});
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
(__VLS_ctx.status?.online ?? 0);
__VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
    ...{ class: "server-list" },
});
/** @type {__VLS_StyleScopedClasses['server-list']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
    ...{ class: "server-card" },
    ...{ style: ({ '--map-image': `url(/maps/${__VLS_ctx.displayMap}.png)` }) },
});
/** @type {__VLS_StyleScopedClasses['server-card']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div)({
    ...{ class: "server-shade" },
});
/** @type {__VLS_StyleScopedClasses['server-shade']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "server-card-main" },
});
/** @type {__VLS_StyleScopedClasses['server-card-main']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "server-card-title" },
});
/** @type {__VLS_StyleScopedClasses['server-card-title']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
    ...{ class: "server-index" },
});
/** @type {__VLS_StyleScopedClasses['server-index']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
(__VLS_ctx.mode.label);
(__VLS_ctx.displayMapName);
let __VLS_0;
/** @ts-ignore @type {typeof __VLS_components.Tag} */
Tag;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
    severity: (__VLS_ctx.phaseSeverity),
    value: (__VLS_ctx.phaseLabel),
    icon: (__VLS_ctx.status?.phase === 'starting' ? 'pi pi-spin pi-spinner' : undefined),
}));
const __VLS_2 = __VLS_1({
    severity: (__VLS_ctx.phaseSeverity),
    value: (__VLS_ctx.phaseLabel),
    icon: (__VLS_ctx.status?.phase === 'starting' ? 'pi pi-spin pi-spinner' : undefined),
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "server-meta" },
});
/** @type {__VLS_StyleScopedClasses['server-meta']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.i)({
    ...{ class: "pi pi-users" },
});
/** @type {__VLS_StyleScopedClasses['pi']} */ ;
/** @type {__VLS_StyleScopedClasses['pi-users']} */ ;
(__VLS_ctx.status?.online ?? 0);
(__VLS_ctx.maxPlayers);
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.i)({
    ...{ class: "pi pi-map" },
});
/** @type {__VLS_StyleScopedClasses['pi']} */ ;
/** @type {__VLS_StyleScopedClasses['pi-map']} */ ;
(__VLS_ctx.displayMapName);
__VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
    ...{ onClick: (__VLS_ctx.copyAddress) },
    ...{ class: "copy-address" },
    type: "button",
    title: "Скопировать адрес",
});
/** @type {__VLS_StyleScopedClasses['copy-address']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.i)({
    ...{ class: "pi pi-copy" },
});
/** @type {__VLS_StyleScopedClasses['pi']} */ ;
/** @type {__VLS_StyleScopedClasses['pi-copy']} */ ;
if (__VLS_ctx.status?.container.running) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "server-card-actions" },
    });
    /** @type {__VLS_StyleScopedClasses['server-card-actions']} */ ;
    let __VLS_5;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_6 = __VLS_asFunctionalComponent1(__VLS_5, new __VLS_5({
        ...{ 'onClick': {} },
        label: "Перезапустить",
        icon: "pi pi-refresh",
        severity: "secondary",
        size: "small",
        loading: (__VLS_ctx.busy),
    }));
    const __VLS_7 = __VLS_6({
        ...{ 'onClick': {} },
        label: "Перезапустить",
        icon: "pi pi-refresh",
        severity: "secondary",
        size: "small",
        loading: (__VLS_ctx.busy),
    }, ...__VLS_functionalComponentArgsRest(__VLS_6));
    let __VLS_10;
    const __VLS_11 = ({ click: {} },
        { onClick: (...[$event]) => {
                if (!(__VLS_ctx.status?.container.running))
                    return;
                __VLS_ctx.action('restart');
                // @ts-ignore
                [status, status, status, status, displayMap, mode, displayMapName, displayMapName, phaseSeverity, phaseLabel, maxPlayers, copyAddress, busy, action,];
            } });
    var __VLS_8;
    var __VLS_9;
    let __VLS_12;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_13 = __VLS_asFunctionalComponent1(__VLS_12, new __VLS_12({
        ...{ 'onClick': {} },
        label: "Остановить",
        icon: "pi pi-stop",
        severity: "danger",
        size: "small",
        outlined: true,
        loading: (__VLS_ctx.busy),
    }));
    const __VLS_14 = __VLS_13({
        ...{ 'onClick': {} },
        label: "Остановить",
        icon: "pi pi-stop",
        severity: "danger",
        size: "small",
        outlined: true,
        loading: (__VLS_ctx.busy),
    }, ...__VLS_functionalComponentArgsRest(__VLS_13));
    let __VLS_17;
    const __VLS_18 = ({ click: {} },
        { onClick: (...[$event]) => {
                if (!(__VLS_ctx.status?.container.running))
                    return;
                __VLS_ctx.action('stop');
                // @ts-ignore
                [busy, action,];
            } });
    var __VLS_15;
    var __VLS_16;
}
if (__VLS_ctx.status && !__VLS_ctx.status.container.running) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "panel launch-panel" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['launch-panel']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "launch-head" },
    });
    /** @type {__VLS_StyleScopedClasses['launch-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_19;
    /** @ts-ignore @type {typeof __VLS_components.Button} */
    Button;
    // @ts-ignore
    const __VLS_20 = __VLS_asFunctionalComponent1(__VLS_19, new __VLS_19({
        ...{ 'onClick': {} },
        label: "Запустить сервер",
        icon: "pi pi-play",
        size: "large",
        loading: (__VLS_ctx.busy),
    }));
    const __VLS_21 = __VLS_20({
        ...{ 'onClick': {} },
        label: "Запустить сервер",
        icon: "pi pi-play",
        size: "large",
        loading: (__VLS_ctx.busy),
    }, ...__VLS_functionalComponentArgsRest(__VLS_20));
    let __VLS_24;
    const __VLS_25 = ({ click: {} },
        { onClick: (...[$event]) => {
                if (!(__VLS_ctx.status && !__VLS_ctx.status.container.running))
                    return;
                __VLS_ctx.action('start');
                // @ts-ignore
                [status, status, busy, action,];
            } });
    var __VLS_22;
    var __VLS_23;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "launch-block" },
    });
    /** @type {__VLS_StyleScopedClasses['launch-block']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    let __VLS_26;
    /** @ts-ignore @type {typeof __VLS_components.SelectButton} */
    SelectButton;
    // @ts-ignore
    const __VLS_27 = __VLS_asFunctionalComponent1(__VLS_26, new __VLS_26({
        modelValue: (__VLS_ctx.mode),
        options: (__VLS_ctx.modes),
        optionLabel: "label",
        allowEmpty: (false),
    }));
    const __VLS_28 = __VLS_27({
        modelValue: (__VLS_ctx.mode),
        options: (__VLS_ctx.modes),
        optionLabel: "label",
        allowEmpty: (false),
    }, ...__VLS_functionalComponentArgsRest(__VLS_27));
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "muted" },
    });
    /** @type {__VLS_StyleScopedClasses['muted']} */ ;
    (__VLS_ctx.mode.hint);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "launch-block" },
    });
    /** @type {__VLS_StyleScopedClasses['launch-block']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "launch-row" },
    });
    /** @type {__VLS_StyleScopedClasses['launch-row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    let __VLS_31;
    /** @ts-ignore @type {typeof __VLS_components.SelectButton} */
    SelectButton;
    // @ts-ignore
    const __VLS_32 = __VLS_asFunctionalComponent1(__VLS_31, new __VLS_31({
        modelValue: (__VLS_ctx.mapSource),
        options: (__VLS_ctx.mapSources),
        optionLabel: "label",
        optionValue: "value",
        allowEmpty: (false),
    }));
    const __VLS_33 = __VLS_32({
        modelValue: (__VLS_ctx.mapSource),
        options: (__VLS_ctx.mapSources),
        optionLabel: "label",
        optionValue: "value",
        allowEmpty: (false),
    }, ...__VLS_functionalComponentArgsRest(__VLS_32));
    if (__VLS_ctx.mapSource === 'official') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "map-grid" },
        });
        /** @type {__VLS_StyleScopedClasses['map-grid']} */ ;
        for (const [m] of __VLS_vFor((__VLS_ctx.mode.maps))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.status && !__VLS_ctx.status.container.running))
                            return;
                        if (!(__VLS_ctx.mapSource === 'official'))
                            return;
                        __VLS_ctx.map = m;
                        // @ts-ignore
                        [mode, mode, mode, modes, mapSource, mapSource, mapSources, map,];
                    } },
                key: (m),
                type: "button",
                ...{ class: "map-card" },
                ...{ class: ({ selected: __VLS_ctx.map === m }) },
            });
            /** @type {__VLS_StyleScopedClasses['map-card']} */ ;
            /** @type {__VLS_StyleScopedClasses['selected']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
                src: (`/maps/${m}.png`),
                alt: (__VLS_ctx.mapNames[m] ?? m),
                loading: "lazy",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (__VLS_ctx.mapNames[m] ?? m);
            if (__VLS_ctx.map === m) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.i)({
                    ...{ class: "pi pi-check-circle" },
                });
                /** @type {__VLS_StyleScopedClasses['pi']} */ ;
                /** @type {__VLS_StyleScopedClasses['pi-check-circle']} */ ;
            }
            // @ts-ignore
            [map, map, mapNames, mapNames,];
        }
    }
    else {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workshop-row" },
        });
        /** @type {__VLS_StyleScopedClasses['workshop-row']} */ ;
        let __VLS_36;
        /** @ts-ignore @type {typeof __VLS_components.InputText} */
        InputText;
        // @ts-ignore
        const __VLS_37 = __VLS_asFunctionalComponent1(__VLS_36, new __VLS_36({
            modelValue: (__VLS_ctx.workshopId),
            placeholder: "ID карты из мастерской, например 3070284539",
        }));
        const __VLS_38 = __VLS_37({
            modelValue: (__VLS_ctx.workshopId),
            placeholder: "ID карты из мастерской, например 3070284539",
        }, ...__VLS_functionalComponentArgsRest(__VLS_37));
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "muted" },
        });
        /** @type {__VLS_StyleScopedClasses['muted']} */ ;
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "launch-block" },
    });
    /** @type {__VLS_StyleScopedClasses['launch-block']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "settings-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['settings-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting" },
    });
    /** @type {__VLS_StyleScopedClasses['setting']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.maxPlayers);
    let __VLS_41;
    /** @ts-ignore @type {typeof __VLS_components.Slider} */
    Slider;
    // @ts-ignore
    const __VLS_42 = __VLS_asFunctionalComponent1(__VLS_41, new __VLS_41({
        modelValue: (__VLS_ctx.maxPlayers),
        min: (2),
        max: (32),
    }));
    const __VLS_43 = __VLS_42({
        modelValue: (__VLS_ctx.maxPlayers),
        min: (2),
        max: (32),
    }, ...__VLS_functionalComponentArgsRest(__VLS_42));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting toggle" },
    });
    /** @type {__VLS_StyleScopedClasses['setting']} */ ;
    /** @type {__VLS_StyleScopedClasses['toggle']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    let __VLS_46;
    /** @ts-ignore @type {typeof __VLS_components.ToggleSwitch} */
    ToggleSwitch;
    // @ts-ignore
    const __VLS_47 = __VLS_asFunctionalComponent1(__VLS_46, new __VLS_46({
        modelValue: (__VLS_ctx.botsEnabled),
    }));
    const __VLS_48 = __VLS_47({
        modelValue: (__VLS_ctx.botsEnabled),
    }, ...__VLS_functionalComponentArgsRest(__VLS_47));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting" },
        ...{ class: ({ disabled: !__VLS_ctx.botsEnabled }) },
    });
    /** @type {__VLS_StyleScopedClasses['setting']} */ ;
    /** @type {__VLS_StyleScopedClasses['disabled']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.botQuota);
    let __VLS_51;
    /** @ts-ignore @type {typeof __VLS_components.Slider} */
    Slider;
    // @ts-ignore
    const __VLS_52 = __VLS_asFunctionalComponent1(__VLS_51, new __VLS_51({
        modelValue: (__VLS_ctx.botQuota),
        min: (0),
        max: (12),
        disabled: (!__VLS_ctx.botsEnabled),
    }));
    const __VLS_53 = __VLS_52({
        modelValue: (__VLS_ctx.botQuota),
        min: (0),
        max: (12),
        disabled: (!__VLS_ctx.botsEnabled),
    }, ...__VLS_functionalComponentArgsRest(__VLS_52));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting" },
        ...{ class: ({ disabled: !__VLS_ctx.botsEnabled }) },
    });
    /** @type {__VLS_StyleScopedClasses['setting']} */ ;
    /** @type {__VLS_StyleScopedClasses['disabled']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    let __VLS_56;
    /** @ts-ignore @type {typeof __VLS_components.Select} */
    Select;
    // @ts-ignore
    const __VLS_57 = __VLS_asFunctionalComponent1(__VLS_56, new __VLS_56({
        modelValue: (__VLS_ctx.botDifficulty),
        options: (__VLS_ctx.difficulties),
        optionLabel: "label",
        optionValue: "value",
        disabled: (!__VLS_ctx.botsEnabled),
    }));
    const __VLS_58 = __VLS_57({
        modelValue: (__VLS_ctx.botDifficulty),
        options: (__VLS_ctx.difficulties),
        optionLabel: "label",
        optionValue: "value",
        disabled: (!__VLS_ctx.botsEnabled),
    }, ...__VLS_functionalComponentArgsRest(__VLS_57));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "launch-block" },
    });
    /** @type {__VLS_StyleScopedClasses['launch-block']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "settings-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['settings-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting toggle" },
    });
    /** @type {__VLS_StyleScopedClasses['setting']} */ ;
    /** @type {__VLS_StyleScopedClasses['toggle']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    let __VLS_61;
    /** @ts-ignore @type {typeof __VLS_components.ToggleSwitch} */
    ToggleSwitch;
    // @ts-ignore
    const __VLS_62 = __VLS_asFunctionalComponent1(__VLS_61, new __VLS_61({
        modelValue: (__VLS_ctx.vac),
    }));
    const __VLS_63 = __VLS_62({
        modelValue: (__VLS_ctx.vac),
    }, ...__VLS_functionalComponentArgsRest(__VLS_62));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting toggle" },
    });
    /** @type {__VLS_StyleScopedClasses['setting']} */ ;
    /** @type {__VLS_StyleScopedClasses['toggle']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    let __VLS_66;
    /** @ts-ignore @type {typeof __VLS_components.ToggleSwitch} */
    ToggleSwitch;
    // @ts-ignore
    const __VLS_67 = __VLS_asFunctionalComponent1(__VLS_66, new __VLS_66({
        modelValue: (__VLS_ctx.friendlyFire),
    }));
    const __VLS_68 = __VLS_67({
        modelValue: (__VLS_ctx.friendlyFire),
    }, ...__VLS_functionalComponentArgsRest(__VLS_67));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting toggle" },
    });
    /** @type {__VLS_StyleScopedClasses['setting']} */ ;
    /** @type {__VLS_StyleScopedClasses['toggle']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    let __VLS_71;
    /** @ts-ignore @type {typeof __VLS_components.ToggleSwitch} */
    ToggleSwitch;
    // @ts-ignore
    const __VLS_72 = __VLS_asFunctionalComponent1(__VLS_71, new __VLS_71({
        modelValue: (__VLS_ctx.practice),
    }));
    const __VLS_73 = __VLS_72({
        modelValue: (__VLS_ctx.practice),
    }, ...__VLS_functionalComponentArgsRest(__VLS_72));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting toggle" },
    });
    /** @type {__VLS_StyleScopedClasses['setting']} */ ;
    /** @type {__VLS_StyleScopedClasses['toggle']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    let __VLS_76;
    /** @ts-ignore @type {typeof __VLS_components.ToggleSwitch} */
    ToggleSwitch;
    // @ts-ignore
    const __VLS_77 = __VLS_asFunctionalComponent1(__VLS_76, new __VLS_76({
        modelValue: (__VLS_ctx.infiniteAmmo),
    }));
    const __VLS_78 = __VLS_77({
        modelValue: (__VLS_ctx.infiniteAmmo),
    }, ...__VLS_functionalComponentArgsRest(__VLS_77));
}
// @ts-ignore
[maxPlayers, maxPlayers, workshopId, botsEnabled, botsEnabled, botsEnabled, botsEnabled, botsEnabled, botQuota, botQuota, botDifficulty, difficulties, vac, friendlyFire, practice, infiniteAmmo,];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
