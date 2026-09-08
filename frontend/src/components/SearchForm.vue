<script setup lang="ts">
const query = defineModel<string>({ required: true })

const emit = defineEmits<{ submit: [] }>()
</script>

<template>
  <form class="search-form" role="search" @submit.prevent="emit('submit')">
    <label class="field-label" for="youtube-search">Поиск на YouTube</label>
    <input
      id="youtube-search"
      v-model="query"
      class="input"
      type="search"
      name="q"
      placeholder="Название трека или исполнитель"
      autocomplete="off"
      enterkeyhint="search"
    >
  </form>
</template>
