import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import App from './App.vue'
import { createAppRouter } from './router'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(createAppRouter(pinia))
app.mount('#app')
