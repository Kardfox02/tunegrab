<script setup lang="ts">
import { computed } from 'vue'

import { TRACK_STATUS_LABELS } from '@/types/track'

const props = defineProps<{ status: keyof typeof TRACK_STATUS_LABELS; progress: number }>()

const percent = computed(() => Math.min(100, Math.max(0, Math.round(props.progress))))
const label = computed(() => TRACK_STATUS_LABELS[props.status] ?? 'Загрузка')
</script>

<template>
  <div class="download-progress">
    <div
      class="download-progress__bar"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`Прогресс загрузки: ${label}`"
    >
      <div class="download-progress__fill" :style="{ width: `${percent}%` }"></div>
    </div>
    <span class="download-progress__label" aria-live="polite">{{ label }} · {{ percent }}%</span>
  </div>
</template>
