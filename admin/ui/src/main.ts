import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import ConfirmationService from 'primevue/confirmationservice'
import ToastService from 'primevue/toastservice'
import Tooltip from 'primevue/tooltip'
import 'primeicons/primeicons.css'
import './style.css'
import App from './App.vue'
import { router } from './router'

document.documentElement.classList.add('verona-dark')

const app = createApp(App)
  .use(createPinia())
  .use(router)
  .use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.verona-dark' } } })
  .use(ConfirmationService)
  .use(ToastService)
app.directive('tooltip', Tooltip)
app.mount('#app')
