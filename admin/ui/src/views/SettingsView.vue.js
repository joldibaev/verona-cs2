import { onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Select from 'primevue/select';
import { useToast } from 'primevue/usetoast';
import { api } from '../api';
const maps = ['de_dust2', 'de_mirage', 'de_inferno', 'de_nuke', 'de_ancient', 'de_anubis', 'de_train', 'de_overpass', 'de_vertigo'];
const map = ref('de_dust2');
const toast = useToast();
onMounted(async () => { map.value = (await api('/api/settings/map')).map; });
async function save() { await api('/api/settings/map', { method: 'PUT', body: JSON.stringify({ map: map.value }) }); toast.add({ severity: 'success', summary: 'Сохранено', detail: 'Команда смены карты отправлена', life: 3000 }); }
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
__VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
    ...{ class: "panel form-panel" },
});
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['form-panel']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "field" },
});
/** @type {__VLS_StyleScopedClasses['field']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
let __VLS_0;
/** @ts-ignore @type {typeof __VLS_components.Select} */
Select;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
    modelValue: (__VLS_ctx.map),
    options: (__VLS_ctx.maps),
    filter: true,
}));
const __VLS_2 = __VLS_1({
    modelValue: (__VLS_ctx.map),
    options: (__VLS_ctx.maps),
    filter: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
let __VLS_5;
/** @ts-ignore @type {typeof __VLS_components.Button} */
Button;
// @ts-ignore
const __VLS_6 = __VLS_asFunctionalComponent1(__VLS_5, new __VLS_5({
    ...{ 'onClick': {} },
    label: "Сохранить и применить",
    icon: "pi pi-check",
}));
const __VLS_7 = __VLS_6({
    ...{ 'onClick': {} },
    label: "Сохранить и применить",
    icon: "pi pi-check",
}, ...__VLS_functionalComponentArgsRest(__VLS_6));
let __VLS_10;
const __VLS_11 = ({ click: {} },
    { onClick: (__VLS_ctx.save) });
var __VLS_8;
var __VLS_9;
// @ts-ignore
[map, maps, save,];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
