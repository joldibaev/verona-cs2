<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Slider from 'primevue/slider'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { api, getMe, type Me, type Skin } from '../api'
import { faceitBadgeStyle, faceitLevel } from '../faceit'

interface CatalogWeapon { weapon: string; name: string; category: string; image: string }
interface CatalogSkin { name: string; weapon: string; weaponName: string; category: string; paint: number; color: string; image: string; minWear: number; maxWear: number }
interface KnownPlayer { steamId: string; name: string; lastSeenAt: string; avatarUrl?: string | null; profileUrl?: string | null; faceitElo?: number | null; faceitNickname?: string | null }
interface SkinCollection { id:number; name:string; active:boolean; count:number }

const categories = [
  { id: 'sfui_invpanel_filter_melee', label: 'Ножи' },
  { id: 'all', label: 'Всё' },
  { id: 'csgo_inventory_weapon_category_pistols', label: 'Пистолеты' },
  { id: 'csgo_inventory_weapon_category_rifles', label: 'Винтовки' },
  { id: 'csgo_inventory_weapon_category_smgs', label: 'SMG' },
  { id: 'csgo_inventory_weapon_category_heavy', label: 'Тяжёлое' },
  { id: 'loadoutslot_equipment', label: 'Zeus' }
]

const me = ref<Me | null>(null)
const weapons = ref<CatalogWeapon[]>([])
const skinsByWeapon = ref<Map<string, CatalogSkin[]>>(new Map())
const mySkins = ref<Record<string, Skin>>({})
const category = ref('all')
const search = ref('')
const loading = ref(true)
const toast = useToast()
const confirm = useConfirm()
const route = useRoute()

// Admins can retarget the editor at any account the server has ever seen.
const players = ref<KnownPlayer[]>([])
const target = ref<KnownPlayer | null>(null)
const editingSelf = computed(() => !me.value?.isAdmin || !target.value || target.value.steamId === me.value?.steamId)
// This is UX only. Backend is the security boundary: /api/me derives SteamID from
// the session, while an arbitrary /api/players target requires an admin session.
const basePath = computed(() => editingSelf.value ? '/api/me/skins' : `/api/players/${target.value!.steamId}/skins`)
const profile = computed(() => editingSelf.value
  ? me.value && ({ steamId: me.value.steamId, name: me.value.name, avatarUrl: me.value.avatarUrl,
      profileUrl: `https://steamcommunity.com/profiles/${me.value.steamId}`, faceitElo: me.value.faceitElo, faceitNickname: me.value.faceitNickname })
  : target.value)

const visibleWeapons = computed(() => {
  const query = search.value.trim().toLowerCase()
  return weapons.value.filter(w =>
    (category.value === 'all' || w.category === category.value) &&
    (!query || w.name.toLowerCase().includes(query) || (currentSkin(w.weapon)?.name ?? '').toLowerCase().includes(query)))
})
function currentSkin(weapon: string): CatalogSkin | null {
  const applied = mySkins.value[weapon]
  if (!applied) return null
  return skinsByWeapon.value.get(weapon)?.find(s => s.paint === applied.paintKit) ?? null
}

async function loadSkins() {
  if (me.value?.isAdmin && !target.value) { mySkins.value = {}; return }
  const list = await api<Skin[]>(basePath.value)
  mySkins.value = Object.fromEntries(list.map(s => [s.weapon, s]))
}
async function retarget() { await loadSkins() }

// Skin picker dialog state.
const dialog = ref(false)
const dialogWeapon = ref<CatalogWeapon | null>(null)
const dialogSearch = ref('')
const picked = ref<CatalogSkin | null>(null)
const wear = ref(0.01)
const seed = ref(0)
const saving = ref(false)
const collections = ref<SkinCollection[]>([])
const collectionDialog = ref(false)
const collectionName = ref('')
const dialogSkins = computed(() => {
  const all = dialogWeapon.value ? (skinsByWeapon.value.get(dialogWeapon.value.weapon) ?? []) : []
  const query = dialogSearch.value.trim().toLowerCase()
  return query ? all.filter(s => s.name.toLowerCase().includes(query)) : all
})
function openWeapon(weapon: CatalogWeapon) {
  if (editingSelf.value && collections.value.length === 0) {
    toast.add({ severity: 'warn', summary: 'Внимание', detail: 'Необходимо создать коллекцию перед выбором скинов', life: 4000 })
    return
  }
  dialogWeapon.value = weapon
  dialogSearch.value = ''
  picked.value = currentSkin(weapon.weapon)
  const applied = mySkins.value[weapon.weapon]
  wear.value = applied?.wear ?? 0.01
  seed.value = applied?.seed ?? 0
  dialog.value = true
}
function pick(skin: CatalogSkin) {
  picked.value = skin
  wear.value = Math.min(Math.max(wear.value, skin.minWear), skin.maxWear)
}
async function save() {
  if (!dialogWeapon.value || !picked.value) return
  saving.value = true
  try {
    await api(`${basePath.value}/${dialogWeapon.value.weapon}`, {
      method: 'PUT',
      body: JSON.stringify({ weapon: dialogWeapon.value.weapon, paintKit: picked.value.paint, wear: wear.value, seed: seed.value })
    })
    await loadSkins()
    dialog.value = false
    toast.add({ severity: 'success', summary: 'Скин сохранён', detail: `${picked.value.name} применится при следующей выдаче оружия`, life: 3000 })
  } catch (e) { toast.add({ severity: 'error', summary: 'Ошибка', detail: String(e), life: 4000 }) }
  finally { saving.value = false }
}
async function resetSkin() {
  if (!dialogWeapon.value || !mySkins.value[dialogWeapon.value.weapon]) { dialog.value = false; return }
  saving.value = true
  try {
    await api(`${basePath.value}/${dialogWeapon.value.weapon}`, { method: 'DELETE' })
    await loadSkins()
    dialog.value = false
    toast.add({ severity: 'success', summary: 'Скин сброшен', life: 2500 })
  } catch (e) { toast.add({ severity: 'error', summary: 'Ошибка', detail: String(e), life: 4000 }) }
  finally { saving.value = false }
}
async function loadCollections() {
  if (editingSelf.value) {
    collections.value = await api<SkinCollection[]>('/api/me/collections')
    if (collections.value.length === 0) {
      await api('/api/me/collections', {
        method: 'POST',
        body: JSON.stringify({ name: 'По умолчанию' })
      })
      collections.value = await api<SkinCollection[]>('/api/me/collections')
      await loadSkins()
    }
  }
}
async function createCollection(){ const name=collectionName.value.trim();if(!name)return;await api('/api/me/collections',{method:'POST',body:JSON.stringify({name})});collectionName.value='';collectionDialog.value=false;await loadCollections() }
async function activateCollection(item:SkinCollection){ if(item.active)return;await api(`/api/me/collections/${item.id}/activate`,{method:'POST'});await Promise.all([loadCollections(),loadSkins()]) }
async function confirmDeleteCollection(item: SkinCollection) {
  confirm.require({
    message: `Вы уверены, что хотите удалить коллекцию "${item.name}"?`,
    header: 'Подтверждение удаления',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Отмена', severity: 'secondary', text: true },
    acceptProps: { label: 'Удалить', severity: 'danger' },
    accept: async () => {
      try {
        await api(`/api/me/collections/${item.id}`, { method: 'DELETE' })
        toast.add({ severity: 'success', summary: 'Коллекция удалена', life: 2500 })
        await Promise.all([loadCollections(), loadSkins()])
      } catch (e) {
        toast.add({ severity: 'error', summary: 'Ошибка', detail: String(e), life: 4000 })
      }
    }
  })
}
const importDialog = ref(false)
const importCode = ref('')
async function shareCollection(item: SkinCollection) {
  try {
    const skins = await api<Skin[]>(`/api/me/collections/${item.id}/skins`)
    const data = {
      name: item.name,
      skins: skins.map(s => ({ weapon: s.weapon, paintKit: s.paintKit, wear: s.wear, seed: s.seed }))
    }
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(data))))
    await navigator.clipboard.writeText(code)
    toast.add({ severity: 'success', summary: 'Код скопирован', detail: 'Код коллекции скопирован в буфер обмена', life: 3000 })
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Ошибка', detail: String(e), life: 4000 })
  }
}
async function importCollection() {
  const code = importCode.value.trim()
  if (!code) return
  try {
    const raw = decodeURIComponent(escape(atob(code)))
    const data = JSON.parse(raw)
    if (!data.name || !Array.isArray(data.skins)) {
      throw new Error('Неверный формат кода коллекции')
    }
    await api('/api/me/collections', {
      method: 'POST',
      body: JSON.stringify({ name: data.name, skins: data.skins })
    })
    importCode.value = ''
    importDialog.value = false
    toast.add({ severity: 'success', summary: 'Коллекция импортирована', life: 3000 })
    await loadCollections()
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Ошибка импорта', detail: 'Не удалось распознать код коллекции. Убедитесь, что скопировали его полностью.', life: 4000 })
  }
}

onMounted(async () => {
  me.value = await getMe()
  // Catalog metadata is public/static for cache-friendly delivery. Save endpoints
  // still validate submitted values because browser data is never trusted.
  const catalog = await (await fetch('/skins-catalog.json')).json() as { weapons: CatalogWeapon[]; skins: CatalogSkin[] }
  weapons.value = catalog.weapons
  const grouped = new Map<string, CatalogSkin[]>()
  for (const skin of catalog.skins) {
    const list = grouped.get(skin.weapon) ?? []
    list.push(skin); grouped.set(skin.weapon, list)
  }
  skinsByWeapon.value = grouped
  if (me.value?.isAdmin) {
    players.value = await api<KnownPlayer[]>('/api/players/known')
    const requestedSteamId = typeof route.query.steamId === 'string' ? route.query.steamId : null
    target.value = players.value.find(p => p.steamId === requestedSteamId)
      ?? players.value.find(p => p.steamId === me.value?.steamId)
      ?? (me.value.steamId ? { steamId: me.value.steamId, name: me.value.name, lastSeenAt: '' } : players.value[0] ?? null)
  }
  await loadSkins()
  await loadCollections()
  loading.value = false
})
</script>

<template>
  <header class="page-header">
    <div><p class="eyebrow">SKINCHANGER</p><h1>Скины оружия</h1></div>
    <div class="target-picker" v-if="me?.isAdmin">
      <label>Игрок</label>
      <Select v-model="target" :options="players" optionLabel="name" filter placeholder="Выберите игрока" @change="retarget">
        <template #option="{ option }"><span>{{ option.name }}</span><span class="muted steamid">{{ option.steamId }}</span></template>
      </Select>
    </div>
  </header>
  <section v-if="profile" class="profile-card">
    <img v-if="profile.avatarUrl" :src="profile.avatarUrl" alt="" />
    <div class="profile-main"><h2>{{ profile.name }}</h2><span>{{ profile.steamId }}</span></div>
    <a class="profile-steam" :href="profile.profileUrl || `https://steamcommunity.com/profiles/${profile.steamId}`" target="_blank">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style="flex-shrink: 0;"><path d="M12 2C6.8 2 2.5 5.9 2 11l5.4 2.2c.5-.3 1-.5 1.6-.5l2.4-3.5v-.1c0-2.1 1.7-3.8 3.8-3.8s3.8 1.7 3.8 3.8-1.7 3.8-3.8 3.8h-.1L11.6 15c0 .5-.1 1-.4 1.4-.7 1.4-2.4 1.9-3.8 1.2-.7-.3-1.2-.9-1.4-1.6l-3.9-1.6C3.1 19.1 7.2 22 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2zM8.3 16.9c.5.9 1.6 1.3 2.5.9.9-.4 1.4-1.5 1-2.5-.4-.9-1.5-1.4-2.4-1l1.3.5c.7.3 1 1.1.7 1.8-.3.7-1.1 1-1.8.7l-1.3-.4zm10.4-7.8c0-1.4-1.1-2.5-2.5-2.5s-2.5 1.1-2.5 2.5 1.1 2.5 2.5 2.5 2.5-1.1 2.5-2.5zm-4.4 0c0-1 .8-1.9 1.9-1.9 1 0 1.9.8 1.9 1.9s-.8 1.9-1.9 1.9c-1 0-1.9-.8-1.9-1.9z"/></svg>
      <span>Steam</span>
    </a>
    <a v-if="profile.faceitElo" :class="['elo-badge', 'profile-elo', profile.faceitNickname ? 'clickable' : '']" :href="profile.faceitNickname ? `https://www.faceit.com/ru/players/${profile.faceitNickname}` : undefined" target="_blank">
      <img :src="`/faceit/lvl${faceitLevel(profile.faceitElo)}.svg`" class="elo-level-img" :alt="`Level ${faceitLevel(profile.faceitElo)}`" />
      <span>{{ profile.faceitElo }} ELO</span>
    </a>
  </section>

  <section class="skinchanger-layout">
  <aside v-if="editingSelf" class="collections-panel">
    <p class="eyebrow">КОЛЛЕКЦИИ · {{ collections.length }}</p>
    <div v-for="item in collections" :key="item.id" class="collection-item" :class="{ active:item.active }" role="button" tabindex="0" @click="activateCollection(item)" @keydown.enter="activateCollection(item)">
      <span>{{item.name}}</span>
      <small>{{item.count}} скинов</small>
      <div class="collection-actions">
        <button type="button" class="collection-action share" title="Поделиться" @click.stop="shareCollection(item)">
          <i class="pi pi-share-alt" />
        </button>
        <button type="button" class="collection-action delete" title="Удалить коллекцию" @click.stop="confirmDeleteCollection(item)">
          <i class="pi pi-trash" />
        </button>
      </div>
    </div>
    <div class="collections-buttons">
      <button type="button" class="collection-btn" @click="collectionDialog=true"><i class="pi pi-plus"/> Создать</button>
      <button type="button" class="collection-btn" @click="importDialog=true"><i class="pi pi-download"/> Импорт</button>
    </div>
  </aside>
  <div class="skinchanger-main">
  <section class="panel skin-toolbar">
    <div class="cat-tabs">
      <button v-for="c in categories" :key="c.id" type="button" class="cat-tab" :class="{ active: category === c.id }" @click="category = c.id">{{ c.label }}</button>
    </div>
    <InputText v-model="search" placeholder="Поиск..." class="skin-search" />
  </section>

  <p v-if="me?.isAdmin && !target" class="muted">Выберите игрока, чтобы редактировать его скины.</p>
  <section v-else class="weapon-grid">
    <button v-for="w in visibleWeapons" :key="w.weapon" type="button" class="weapon-card" :style="{ '--rarity': currentSkin(w.weapon)?.color ?? '#30343d' }" @click="openWeapon(w)">
      <span v-if="currentSkin(w.weapon)" class="rarity-dot" :style="{ background: currentSkin(w.weapon)!.color }" />
      <img :src="currentSkin(w.weapon)?.image || w.image" :alt="w.name" loading="lazy" :class="{ vanilla: !currentSkin(w.weapon) }" />
      <span class="weapon-title">{{ w.name }}</span>
      <span class="skin-title" :class="{ muted: !currentSkin(w.weapon) }">{{ currentSkin(w.weapon)?.name.split('| ')[1] ?? 'Добавить скин' }}</span>
    </button>
  </section>
  </div>
  </section>

  <Dialog v-model:visible="collectionDialog" modal header="Новая коллекция" :style="{width:'28rem'}">
    <div class="field"><label>Название</label><InputText v-model="collectionName" maxlength="48" placeholder="Например, Competitive" autofocus /></div>
    <template #footer><Button label="Отмена" text @click="collectionDialog=false"/><Button label="Создать" icon="pi pi-plus" @click="createCollection"/></template>
  </Dialog>

  <Dialog v-model:visible="importDialog" modal header="Импорт коллекции" :style="{width:'28rem'}">
    <div class="field" style="display: grid; gap: 7px;"><label>Код коллекции</label><textarea class="p-inputtext" style="width: 100%; resize: none; font-family: monospace; font-size: 12px;" rows="6" v-model="importCode" placeholder="Вставьте код..." autofocus></textarea></div>
    <template #footer><Button label="Отмена" text @click="importDialog=false"/><Button label="Импортировать" icon="pi pi-download" @click="importCollection"/></template>
  </Dialog>

  <Dialog v-model:visible="dialog" modal :header="dialogWeapon?.name ?? ''" class="skin-dialog" :style="{ width: 'min(1080px, 96vw)' }">
    <div class="dialog-toolbar">
      <InputText v-model="dialogSearch" placeholder="Поиск скина..." autofocus />
      <div class="wear-seed">
        <div class="wear-box">
          <span>Wear (float): <b>{{ wear.toFixed(4) }}</b></span>
          <Slider :model-value="wear" @update:model-value="v => wear = Array.isArray(v) ? v[0] : v" :min="picked?.minWear ?? 0" :max="picked?.maxWear ?? 1" :step="0.0001" />
        </div>
        <div class="seed-box"><span>Seed</span><InputNumber v-model="seed" :min="0" :max="1000" showButtons /></div>
      </div>
    </div>
    <div class="skin-grid">
      <button v-for="s in dialogSkins" :key="s.paint" type="button" class="skin-card" :class="{ selected: picked?.paint === s.paint }" :style="{ '--rarity': s.color }" @click="pick(s)">
        <img :src="s.image" :alt="s.name" loading="lazy" />
        <span>{{ s.name.split('| ')[1] ?? s.name }}</span>
      </button>
    </div>
    <template #footer>
      <Button label="Сбросить скин" severity="danger" text :disabled="!dialogWeapon || !mySkins[dialogWeapon.weapon]" :loading="saving" @click="resetSkin" />
      <Button label="Отмена" text @click="dialog = false" />
      <Button label="Сохранить" icon="pi pi-check" :disabled="!picked" :loading="saving" @click="save" />
    </template>
  </Dialog>
</template>
