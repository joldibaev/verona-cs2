<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Avatar from 'primevue/avatar'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { api, type Player } from '../api'
import { faceitBadgeStyle, faceitLevel } from '../faceit'

const players = ref<Player[]>([])
const router = useRouter()
const confirm = useConfirm()
const toast = useToast()
const roles = [{ label: 'Игрок', value: 'player' }, { label: 'Администратор', value: 'admin' }]
const onlineCount = computed(() => players.value.filter(p => p.online).length)
const search = ref('')
const filteredPlayers = computed(() => { const q=search.value.trim().toLowerCase(); return q ? players.value.filter(p => p.name.toLowerCase().includes(q)||p.steamId.includes(q)) : players.value })


async function load() { players.value = await api<Player[]>('/api/players') }
async function changeRole(player: Player, role: 'player' | 'admin') {
  try {
    await api(`/api/players/${player.steamId}/role`, { method: 'PUT', body: JSON.stringify({ role }) })
    toast.add({ severity: 'success', summary: 'Роль обновлена', life: 2200 }); await load()
  } catch (error) { toast.add({ severity: 'error', summary: 'Роль не изменена', detail: String(error), life: 4000 }); await load() }
}
function kick(player: Player) {
  confirm.require({ message: `Кикнуть ${player.name}?`, header: 'Подтверждение', acceptLabel: 'Кикнуть', rejectLabel: 'Отмена',
    accept: async () => { await api(`/api/players/${player.steamId}/kick`, { method: 'POST', body: JSON.stringify({ type: 'kick', reason: 'Removed by admin' }) }); toast.add({ severity: 'success', summary: 'Команда отправлена', life: 2200 }) } })
}
function toggleBan(player: Player) {
  const action = player.banned ? 'Разбанить' : 'Забанить навсегда'
  confirm.require({ message: `${action} ${player.name}?`, header: 'Блокировка', acceptLabel: action, rejectLabel: 'Отмена', acceptClass: player.banned ? '' : 'p-button-danger',
    accept: async () => {
      if (player.banned) await api(`/api/players/${player.steamId}/ban`, { method: 'DELETE' })
      else await api(`/api/players/${player.steamId}/ban`, { method: 'POST', body: JSON.stringify({ reason: 'Banned by admin', durationMinutes: null }) })
      toast.add({ severity: 'success', summary: player.banned ? 'Игрок разбанен' : 'Игрок забанен', life: 2200 }); await load()
    } })
}
function skins(player: Player) { router.push({ path: '/skinchanger', query: { steamId: player.steamId } }) }

let timer = 0
onMounted(async () => { await load(); timer = window.setInterval(load, 5000) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <header class="page-header players-head">
    <div><p class="eyebrow">VERONA PLAYERS</p><h1>Игроки</h1><span class="muted">{{ players.length }} всего · {{ onlineCount }} онлайн</span></div>
    <label class="player-search"><i class="pi pi-search" aria-hidden="true"/><InputText v-model="search" placeholder="Имя или SteamID" /></label>
  </header>
  <section class="panel table-panel">
    <DataTable :value="filteredPlayers" data-key="steamId" paginator :rows="20" :rows-per-page-options="[20,50,100]" class="players-table">
      <template #empty>В базе пока нет игроков.</template>
      <Column header="Игрок" sortable sort-field="name">
        <template #body="{ data }"><div class="player-cell">
          <Avatar :image="data.avatarUrl || undefined" :label="data.avatarUrl ? undefined : data.name.slice(0,1)" shape="circle" size="large" />
          <div><a :href="data.profileUrl || `https://steamcommunity.com/profiles/${data.steamId}`" target="_blank">{{ data.name }}</a><small>{{ data.steamId }}</small></div>
        </div></template>
      </Column>
      <Column header="Статус"><template #body="{ data }"><Tag :value="data.online ? 'Онлайн' : 'Не в сети'" :severity="data.online ? 'success' : 'secondary'" /></template></Column>
      <Column header="FACEIT"><template #body="{ data }"><span v-if="data.faceitElo" class="elo-badge row-elo"><img :src="`/faceit/lvl${faceitLevel(data.faceitElo)}.svg`" class="elo-level-img" :alt="`Level ${faceitLevel(data.faceitElo)}`" /><b>{{ data.faceitElo }}</b></span><span v-else class="muted">-</span></template></Column>
      <Column header="Роль"><template #body="{ data }"><Select :model-value="data.role" :options="roles" option-label="label" option-value="value" @update:model-value="changeRole(data, $event)" /></template></Column>
      <Column header="Бан"><template #body="{ data }"><Tag v-if="data.banned" value="Забанен" severity="danger" /><span v-else class="muted">Нет</span></template></Column>
      <Column header="Последний визит" sortable sort-field="lastSeenAt"><template #body="{ data }">{{ new Date(data.lastSeenAt).toLocaleString('ru-RU') }}</template></Column>
      <Column header="Действия"><template #body="{ data }"><div class="row-actions">
        <Button icon="pi pi-palette" rounded text v-tooltip.top="'Скины'" @click="skins(data)" />
        <Button icon="pi pi-sign-out" rounded text severity="warn" :disabled="!data.online" v-tooltip.top="'Кикнуть'" @click="kick(data)" />
        <Button :icon="data.banned ? 'pi pi-lock-open' : 'pi pi-ban'" rounded text :severity="data.banned ? 'secondary' : 'danger'" v-tooltip.top="data.banned ? 'Разбанить' : 'Забанить'" @click="toggleBan(data)" />
      </div></template></Column>
    </DataTable>
  </section>
</template>
