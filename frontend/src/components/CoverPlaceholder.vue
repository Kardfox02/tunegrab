<script setup lang="ts">
import { ref, useAttrs, watch } from 'vue'

import AppIcon from './AppIcon.vue'

// inheritAttrs: false + ручной spread: классы/стили родителя ложатся
// непосредственно на img/AppIcon, не на условный корень (селекторы вида
// `.parent img` / `.parent svg` продолжают работать).
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    src: string | null
    alt?: string
  }>(),
  { alt: '' },
)

const emit = defineEmits<{ load: [] }>()

const attrs = useAttrs()

// Битая обложка: ловим error у <img> и переключаемся на SVG-заглушку.
// Сброс — при смене src (новая обложка могла загрузиться нормально).
const coverFailed = ref(false)

watch(
  () => props.src,
  () => {
    coverFailed.value = false
  },
)
</script>

<template>
  <img
    v-if="props.src && !coverFailed"
    v-bind="attrs"
    :src="props.src"
    :alt="props.alt"
    loading="lazy"
    decoding="async"
    @load="emit('load')"
    @error="coverFailed = true"
  >
  <AppIcon v-else v-bind="attrs" name="note" />
</template>
