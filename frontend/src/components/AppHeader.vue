<script setup lang="ts">
import { computed } from 'vue'

import { useAuthStore } from '@/stores/auth.store'

const auth = useAuthStore()
const username = computed(() => auth.currentUser?.username ?? '')
</script>

<template>
  <header class="app-header">
    <RouterLink to="/" class="app-header__logo">Tunegrab</RouterLink>
    <span v-if="username" class="app-header__user">{{ username }}</span>
  </header>
</template>
