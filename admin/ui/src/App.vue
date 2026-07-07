<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
import { clearMe, getMe, type Me } from './api'
import { faceitBadgeStyle, faceitLevel } from './faceit'

const route = useRoute(); const router = useRouter()
const isLogin = computed(() => route.path === '/login')
const me = ref<Me | null>(null)
watch(() => route.path, async () => { if (!isLogin.value) me.value = await getMe() }, { immediate: true })
const links = computed(() => me.value?.isAdmin
  ? [{ to:'/', label:'Серверы' }, { to:'/players', label:'Игроки' }, { to:'/skinchanger', label:'Skinchanger' }]
  : [{ to:'/skinchanger', label:'Skinchanger' }])
const currentFaceitLevel = computed(() => me.value?.faceitElo ? faceitLevel(me.value.faceitElo) : 0)
async function logout(){ await fetch('/api/auth/logout',{method:'POST'}); clearMe(); await router.push('/login') }
</script>

<template>
  <Toast/><ConfirmDialog/>
  <RouterView v-if="isLogin"/>
  <div v-else class="app-shell">
    <header class="topbar">
      <div class="topbar-inner">
        <RouterLink to="/" class="wordmark"><span>V</span>VERONA</RouterLink>
        <nav><RouterLink v-for="link in links" :key="link.to" :to="link.to">{{link.label}}</RouterLink></nav>
        <div class="account" v-if="me">
          <div v-if="me.faceitElo" class="elo-badge"><img :src="`/faceit/lvl${currentFaceitLevel}.svg`" class="elo-level-img" :alt="`Level ${currentFaceitLevel}`" /><b>{{me.faceitElo}} ELO</b></div>
          <img v-if="me.avatarUrl" :src="me.avatarUrl" alt=""/><i v-else class="pi pi-user"/>
          <span>{{me.name}}</span>
          <Button icon="pi pi-sign-out" text rounded severity="secondary" aria-label="Выйти" @click="logout"/>
        </div>
      </div>
    </header>
    <main class="content"><RouterView/></main>
  </div>
</template>
