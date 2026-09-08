<script setup lang="ts">
withDefaults(defineProps<{ title?: string; message?: string }>(), {
  title: 'Не удалось загрузить данные',
  message: 'Проверьте соединение и попробуйте еще раз.',
})

defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="state-block" role="alert">
    <div class="state-block__title">{{ title }}</div>
    <div class="state-block__message">{{ message }}</div>
    <button class="btn btn-secondary" type="button" @click="$emit('retry')">Повторить</button>
  </div>
</template>
