<script setup lang="ts">
withDefaults(
  defineProps<{ name: 'book' | 'search' | 'gear' | 'panel' | 'play' | 'pause' | 'volume' | 'trash' | 'skip-prev' | 'skip-next' | 'heart' | 'user'; filled?: boolean }>(),
  { filled: false },
)
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'book'">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </template>
    <template v-else-if="name === 'gear'">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
      />
    </template>
    <template v-else-if="name === 'play'">
      <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'pause'">
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'volume'">
      <polygon points="11 5 6 9 3 9 3 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </template>
    <template v-else-if="name === 'skip-prev'">
      <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none" />
      <path d="M5 5v14" />
    </template>
    <template v-else-if="name === 'skip-next'">
      <polygon points="6 4 16 12 6 20 6 4" fill="currentColor" stroke="none" />
      <path d="M19 5v14" />
    </template>
    <template v-else-if="name === 'heart'">
      <path
        d="M12 20.5C7 16.5 3.5 13.2 3.5 9.6 3.5 7 5.6 5 8.1 5c1.5 0 3 .7 3.9 2 .9-1.3 2.4-2 3.9-2 2.5 0 4.6 2 4.6 4.6 0 3.6-3.5 6.9-8.5 10.9z"
        :fill="filled ? 'currentColor' : 'none'"
      />
    </template>
    <template v-else-if="name === 'user'">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="m6 7 1 13h10l1-13" />
    </template>
    <template v-else>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </template>
  </svg>
</template>
