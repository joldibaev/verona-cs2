<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { HubConnectionBuilder } from '@microsoft/signalr'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import Slider from 'primevue/slider'
import Tag from 'primevue/tag'
import ToggleSwitch from 'primevue/toggleswitch'
import { useToast } from 'primevue/usetoast'
import { api } from '../api'

interface Status {
  container: { running: boolean; status: string; startedAt?: string }
  phase: 'stopped' | 'starting' | 'ready'; ready: boolean
  currentMap: string; online: number; lastHeartbeat: string
}
interface Launch {
  map: string; workshopMapId: string; gameType: number; gameMode: number; maxPlayers: number
  insecure: boolean; botsEnabled: boolean; botQuota: number; botDifficulty: number
  practice: boolean; infiniteAmmo: boolean; friendlyFire: boolean
}
interface Mode { label: string; hint: string; gameType: number; gameMode: number; maps: string[] }

const mapNames: Record<string, string> = {
  de_dust2: 'Dust II', de_mirage: 'Mirage', de_inferno: 'Inferno', de_nuke: 'Nuke',
  de_ancient: 'Ancient', de_anubis: 'Anubis', de_train: 'Train', de_overpass: 'Overpass', de_vertigo: 'Vertigo'
}
const activeDuty = ['de_dust2','de_mirage','de_inferno','de_nuke','de_ancient','de_anubis','de_train','de_overpass','de_vertigo']
// Wingman uses its own official pool: the big maps have no 2v2 layout.
const wingman = ['de_inferno','de_nuke','de_overpass','de_vertigo']
const modes: Mode[] = [
  { label: 'Casual', hint: 'Обычный: без ограничений, свободный вход', gameType: 0, gameMode: 0, maps: activeDuty },
  { label: 'Competitive', hint: 'Соревновательный: 5×5, MR24', gameType: 0, gameMode: 1, maps: activeDuty },
  { label: 'Wingman', hint: 'Напарники: 2×2, укороченные карты', gameType: 0, gameMode: 2, maps: wingman },
  { label: 'Deathmatch', hint: 'Deathmatch: мгновенное возрождение', gameType: 1, gameMode: 2, maps: activeDuty }
]
const mapSources = [ { label: 'Официальные', value: 'official' }, { label: 'Мастерская', value: 'workshop' } ]
const difficulties = [
  { label: 'Лёгкие', value: 0 }, { label: 'Средние', value: 1 },
  { label: 'Сложные', value: 2 }, { label: 'Эксперт', value: 3 }
]

const status = ref<Status | null>(null)
const busy = ref(false)
const mode = ref<Mode>(modes[0])
const map = ref('de_dust2')
const mapSource = ref<'official' | 'workshop'>('official')
const workshopId = ref('')
const maxPlayers = ref(10)
const vac = ref(true)
const friendlyFire = ref(false)
const botsEnabled = ref(true)
const botQuota = ref(5)
const botDifficulty = ref(1)
const practice = ref(false)
const infiniteAmmo = ref(false)
const toast = useToast()

const phaseLabel = computed(() => status.value?.phase === 'ready' ? 'Сервер готов' : status.value?.phase === 'starting' ? 'Сервер запускается' : 'Сервер остановлен')
const phaseSeverity = computed(() => status.value?.phase === 'ready' ? 'success' : status.value?.phase === 'starting' ? 'warn' : 'danger')
const displayMap = computed(() => status.value?.ready && status.value.currentMap !== 'unknown' ? status.value.currentMap : map.value)
const displayMapName = computed(() => mapNames[displayMap.value] ?? displayMap.value)
async function load() {
  status.value = await api<Status>('/api/server/status')
}
async function copyAddress() {
  await navigator.clipboard.writeText('localhost:27015')
  toast.add({ severity: 'success', summary: 'Адрес скопирован', detail: 'localhost:27015', life: 1800 })
}
async function loadLaunch() {
  const launch = await api<Launch>('/api/server/launch')
  mode.value = modes.find(m => m.gameType === launch.gameType && m.gameMode === launch.gameMode) ?? modes[0]
  map.value = mode.value.maps.includes(launch.map) ? launch.map : mode.value.maps[0]
  workshopId.value = launch.workshopMapId
  mapSource.value = launch.workshopMapId ? 'workshop' : 'official'
  maxPlayers.value = launch.maxPlayers
  vac.value = !launch.insecure
  botsEnabled.value = launch.botsEnabled
  botQuota.value = launch.botQuota
  botDifficulty.value = launch.botDifficulty
  practice.value = launch.practice
  infiniteAmmo.value = launch.infiniteAmmo
  friendlyFire.value = launch.friendlyFire
}
watch(mode, m => { if (!m.maps.includes(map.value)) map.value = m.maps[0] })
// Cheats-based options cannot work while VAC is active: drop it automatically.
watch([practice, infiniteAmmo], ([p, ammo]) => { if (p || ammo) vac.value = false })

async function action(name: 'start'|'stop'|'restart') {
  if (name === 'start' && mapSource.value === 'workshop' && !/^\d{1,20}$/.test(workshopId.value.trim())) {
    toast.add({ severity: 'warn', summary: 'Мастерская', detail: 'Укажите числовой ID карты из Steam Workshop', life: 4000 })
    return
  }
  busy.value = true
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
      : undefined
    await api(`/api/server/${name}`, { method: 'POST', body })
    await new Promise(r => setTimeout(r, 300)); await load()
  }
  catch (e) { toast.add({ severity: 'error', summary: 'Ошибка', detail: String(e), life: 4000 }) }
  finally { busy.value = false }
}
let timer = 0
const hub = new HubConnectionBuilder().withUrl('/hub').withAutomaticReconnect().build()
onMounted(async () => { await load(); await loadLaunch(); timer = window.setInterval(load, 2000); hub.on('serverChanged', load); await hub.start().catch(() => {}) })
onUnmounted(() => { clearInterval(timer); void hub.stop() })
</script>

<template>
  <header class="page-header"><div><p class="eyebrow">VERONA NETWORK</p><h1>Серверы</h1></div><span class="muted">1 сервер · {{ status?.online ?? 0 }} игроков онлайн</span></header>

  <section class="server-list">
    <article class="server-card" :style="{ '--map-image': `url(/maps/${displayMap}.png)` }">
      <div class="server-shade" />
      <div class="server-card-main">
        <div class="server-card-title"><span class="server-index">01</span><div><h2>Verona #1</h2><p>{{ mode.label }} · {{ displayMapName }}</p></div></div>
        <Tag :severity="phaseSeverity" :value="phaseLabel" :icon="status?.phase === 'starting' ? 'pi pi-spin pi-spinner' : undefined" />
      </div>
      <div class="server-meta">
        <span><i class="pi pi-users" /> {{ status?.online ?? 0 }}/{{ maxPlayers }}</span>
        <span><i class="pi pi-map" /> {{ displayMapName }}</span>
        <button class="copy-address" type="button" title="Скопировать адрес" @click="copyAddress"><i class="pi pi-copy" /> localhost:27015</button>
      </div>
      <div class="server-card-actions" v-if="status?.container.running">
        <Button label="Перезапустить" icon="pi pi-refresh" severity="secondary" size="small" :loading="busy" @click="action('restart')" />
        <Button label="Остановить" icon="pi pi-stop" severity="danger" size="small" outlined :loading="busy" @click="action('stop')" />
      </div>
    </article>
  </section>

  <section class="panel launch-panel" v-if="status && !status.container.running">
    <div class="launch-head">
      <div><h2>Запуск сервера</h2><p>Режим, карта и настройки применяются при старте.</p></div>
      <Button label="Запустить сервер" icon="pi pi-play" size="large" :loading="busy" @click="action('start')" />
    </div>

    <div class="launch-block">
      <label>Режим игры</label>
      <SelectButton v-model="mode" :options="modes" optionLabel="label" :allowEmpty="false" />
      <p class="muted">{{ mode.hint }}</p>
    </div>

    <div class="launch-block">
      <div class="launch-row">
        <label>Карта</label>
        <SelectButton v-model="mapSource" :options="mapSources" optionLabel="label" optionValue="value" :allowEmpty="false" />
      </div>
      <div v-if="mapSource === 'official'" class="map-grid">
        <button v-for="m in mode.maps" :key="m" type="button" class="map-card" :class="{ selected: map === m }" @click="map = m">
          <img :src="`/maps/${m}.png`" :alt="mapNames[m] ?? m" loading="lazy" />
          <span>{{ mapNames[m] ?? m }}</span>
          <i v-if="map === m" class="pi pi-check-circle" />
        </button>
      </div>
      <div v-else class="workshop-row">
        <InputText v-model="workshopId" placeholder="ID карты из мастерской, например 3070284539" />
        <p class="muted">Сервер сам скачает карту из Steam Workshop при запуске. ID — число из ссылки steamcommunity.com/sharedfiles/filedetails/?id=…</p>
      </div>
    </div>

    <div class="launch-block">
      <label>Игроки и боты</label>
      <div class="settings-grid">
        <div class="setting"><span>Макс. игроков: <b>{{ maxPlayers }}</b></span><Slider v-model="maxPlayers" :min="2" :max="32" /></div>
        <div class="setting toggle"><span>Боты<small>bot_quota_mode fill — добивают до квоты</small></span><ToggleSwitch v-model="botsEnabled" /></div>
        <div class="setting" :class="{ disabled: !botsEnabled }"><span>Количество ботов: <b>{{ botQuota }}</b></span><Slider v-model="botQuota" :min="0" :max="12" :disabled="!botsEnabled" /></div>
        <div class="setting" :class="{ disabled: !botsEnabled }"><span>Сложность ботов</span><Select v-model="botDifficulty" :options="difficulties" optionLabel="label" optionValue="value" :disabled="!botsEnabled" /></div>
      </div>
    </div>

    <div class="launch-block">
      <label>Сервер</label>
      <div class="settings-grid">
        <div class="setting toggle"><span>VAC<small>защита от читов; несовместима с режимами ниже</small></span><ToggleSwitch v-model="vac" /></div>
        <div class="setting toggle"><span>Огонь по своим<small>mp_friendlyfire</small></span><ToggleSwitch v-model="friendlyFire" /></div>
        <div class="setting toggle"><span>Режим тренировки<small>sv_cheats, 60 000$, покупка везде, раунды по 60 мин, respawn</small></span><ToggleSwitch v-model="practice" /></div>
        <div class="setting toggle"><span>Бесконечные патроны<small>sv_infinite_ammo 1, включает sv_cheats</small></span><ToggleSwitch v-model="infiniteAmmo" /></div>
      </div>
    </div>
  </section>

</template>
