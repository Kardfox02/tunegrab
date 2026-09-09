<script setup lang="ts">
import { computed } from 'vue'

import { useAuthStore } from '@/stores/auth.store'

const auth = useAuthStore()
const username = computed(() => auth.currentUser?.username ?? '')
</script>

<template>
  <header class="app-header">
    <RouterLink to="/" class="app-header__logo">Tunegrab</RouterLink>
    <RouterLink v-if="username" to="/admin" class="app-header__user" aria-label="Панель управления">
      {{ username }}
    </RouterLink>
  </header>
</template>
