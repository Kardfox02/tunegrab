<script setup lang="ts">
withDefaults(defineProps<{ message?: string }>(), {
  message: 'Загрузка...',
})
</script>

<template>
  <div class="state-block" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true" />
    <span class="state-block__message">{{ message }}</span>
  </div>
</template>
