<script setup lang="ts">
import AppIcon from './AppIcon.vue'

interface NavigationItem {
  name: string
  label: string
  icon: 'book' | 'search' | 'user'
}

const navigationItems: NavigationItem[] = [
  { name: 'library', label: 'Библиотека', icon: 'book' },
  { name: 'search', label: 'Поиск', icon: 'search' },
  { name: 'settings', label: 'Профиль', icon: 'user' },
]
</script>

<template>
  <div class="app-sidebar">
    <nav class="app-sidebar__nav" aria-label="Основная навигация">
      <RouterLink
        v-for="item in navigationItems"
        :key="item.name"
        :to="{ name: item.name }"
        class="app-sidebar__link"
        :aria-label="item.label"
      >
        <AppIcon :name="item.icon" class="app-sidebar__icon" />
        <span class="app-sidebar__label" aria-hidden="true">{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>
