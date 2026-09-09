<script setup lang="ts">
import { computed } from 'vue'

import type { AdminHealth } from '@/types/admin'

const props = defineProps<{
  storage: AdminHealth['storage']
  diskFreeBytes: number
}>()

// Страховка от невалидного пропа: рендер не должен падать (см. §6 —
// мусорный ответ превращается в ошибку секции). Реальная валидация —
// в вызывающем коде (AdminView.loadHealth).
const safeStorage = computed<AdminHealth['storage']>(() => {
  const source = props.storage
  if (source === null || typeof source !== 'object' || typeof source.total_bytes !== 'number') {
    return { audio_bytes: 0, covers_bytes: 0, thumbnails_bytes: 0, total_bytes: 0 }
  }
  return {
    audio_bytes: source.audio_bytes ?? 0,
    covers_bytes: source.covers_bytes ?? 0,
    thumbnails_bytes: source.thumbnails_bytes ?? 0,
    total_bytes: source.total_bytes,
  }
})

const safeDiskFree = computed(() =>
  typeof props.diskFreeBytes === 'number' && Number.isFinite(props.diskFreeBytes) && props.diskFreeBytes > 0
    ? props.diskFreeBytes
    : 0,
)

const radius = 42
const circumference = 2 * Math.PI * radius

// Сегменты рисуются stroke-dasharray по окружности. Нулевые категории не
// рендерятся вовсе (иначе round-cap рисует точку), зазор ставится только
// между существующими дугами; одиночная дуга — полное кольцо без разрывов.
const GAP = 2

interface DonutSegment {
  label: string
  value: number
  color: string
}

const segments = computed<DonutSegment[]>(() => {
  const { audio_bytes: audio, covers_bytes: covers, thumbnails_bytes: thumbnails } = safeStorage.value
  const result: DonutSegment[] = [
    { label: 'Аудио', value: audio, color: 'var(--color-accent)' },
    { label: 'Обложки', value: covers, color: 'var(--color-success)' },
    { label: 'Превью', value: thumbnails, color: 'var(--color-warning)' },
  ]
  if (safeDiskFree.value > 0) {
    result.push({ label: 'Свободно', value: safeDiskFree.value, color: 'var(--color-surface-hover)' })
  }
  return result.filter((segment) => segment.value > 0)
})

const arcs = computed(() => {
  const total = segments.value.reduce((sum, segment) => sum + segment.value, 0)
  if (total <= 0) {
    return []
  }
  const visibleCount = segments.value.length
  const gap = visibleCount > 1 ? GAP : 0
  let offset = 0
  return segments.value.map((segment) => {
    const fraction = segment.value / total
    const length = Math.max(fraction * circumference - gap, 0)
    const arc = {
      ...segment,
      dash: `${length} ${circumference - length}`,
      offset: -offset,
    }
    offset += fraction * circumference
    return arc
  })
})

const totalLabel = computed(() => formatBytes(safeStorage.value.total_bytes))

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} Б`
  }
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ']
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex += 1
  } while (value >= 1024 && unitIndex < units.length - 1)
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`
}

const ariaLabel = computed(() => {
  const parts = arcs.value.map((arc) => `${arc.label} ${formatBytes(arc.value)}`)
  return `Хранилище: занято ${totalLabel}. ${parts.join(', ')}`
})
</script>

<template>
  <div class="storage-donut">
    <svg
      class="storage-donut__chart"
      viewBox="0 0 100 100"
      role="img"
      :aria-label="ariaLabel"
    >
      <circle class="storage-donut__track" cx="50" cy="50" :r="radius" />
      <circle
        v-for="arc in arcs"
        :key="arc.label"
        class="storage-donut__arc"
        :stroke="arc.color"
        :stroke-dasharray="arc.dash"
        :stroke-dashoffset="arc.offset"
        cx="50"
        cy="50"
        :r="radius"
      />
    </svg>
    <span class="storage-donut__total">
      <span class="storage-donut__total-value">{{ totalLabel }}</span>
      <span class="storage-donut__total-label">занято</span>
    </span>
  </div>

  <ul class="storage-donut__legend">
    <li v-for="arc in arcs" :key="arc.label" class="storage-donut__legend-item">
      <span class="storage-donut__swatch" :style="{ background: arc.color }" aria-hidden="true"></span>
      <span class="storage-donut__legend-label">{{ arc.label }}</span>
      <span class="storage-donut__legend-value">{{ formatBytes(arc.value) }}</span>
    </li>
  </ul>
</template>
