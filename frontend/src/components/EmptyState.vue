<script setup lang="ts">
withDefaults(defineProps<{ title?: string; message?: string }>(), {
  title: 'Здесь пока пусто',
  message: 'Когда появятся данные, они будут показаны здесь.',
})
</script>

<template>
  <div class="state-block">
    <div class="state-block__title">{{ title }}</div>
    <div class="state-block__message">{{ message }}</div>
    <slot />
  </div>
</template>
