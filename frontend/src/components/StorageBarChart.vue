<script setup lang="ts">
import { computed } from 'vue'

import { formatBytes } from '@/utils/format'
import type { AdminHealth } from '@/types/admin'

const props = defineProps<{
  storage: AdminHealth['storage']
  diskFreeBytes: number
}>()

// Страховка от невалидного пропа: рендер не должен падать. Реальная
// валидация — в вызывающем коде (AdminView.loadHealth).
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

interface LegendEntry {
  label: string
  value: number
  color: string
}

interface BarSegment extends LegendEntry {
  pct: number
}

const FREE_COLOR = 'var(--color-surface-hover)'

// Ёмкость шкалы: всё занятое плюс свободное место того же тома. Сегменты —
// обычные siblings в flex-потоке, поэтому перекрытие невозможно по
// построению; доля задается простой шириной в процентах.
const diskCapacity = computed(() => safeStorage.value.total_bytes + safeDiskFree.value)

const usedSegments = computed<BarSegment[]>(() => {
  const capacity = diskCapacity.value
  const storage = safeStorage.value
  const definitions: LegendEntry[] = [
    { label: 'Аудио', value: storage.audio_bytes, color: 'var(--color-accent)' },
    { label: 'Обложки', value: storage.covers_bytes, color: 'var(--color-success)' },
    { label: 'Превью', value: storage.thumbnails_bytes, color: 'var(--color-warning)' },
  ]
  return definitions
    .filter((definition) => definition.value > 0)
    .map((definition) => ({
      ...definition,
      pct: capacity > 0 ? (definition.value / capacity) * 100 : 0,
    }))
})

// Серый фон трека сам является сегментом «Свободно» (как в проводнике
// Windows), поэтому в легенду свободное место добавляется отдельно.
const legendEntries = computed<LegendEntry[]>(() => {
  const entries = usedSegments.value.map(({ label, value, color }) => ({ label, value, color }))
  if (safeDiskFree.value > 0) {
    entries.push({ label: 'Свободно', value: safeDiskFree.value, color: FREE_COLOR })
  }
  return entries
})

const usedLabel = computed(() => formatBytes(safeStorage.value.total_bytes))

const freeLabel = computed(() => formatBytes(safeDiskFree.value))

const ariaLabel = computed(() => {
  const parts = legendEntries.value.map((entry) => `${entry.label} ${formatBytes(entry.value)}`)
  return `Хранилище: занято ${usedLabel.value}, свободно ${freeLabel.value}. ${parts.join(', ')}`
})
</script>

<template>
  <div class="storage-bar">
    <div class="storage-bar__labels">
      <span>Занято {{ usedLabel }}</span>
      <span>Свободно {{ freeLabel }}</span>
    </div>

    <div class="storage-bar__track" role="img" :aria-label="ariaLabel">
      <div
        v-for="segment in usedSegments"
        :key="segment.label"
        class="storage-bar__seg"
        :style="{ width: `${segment.pct}%`, backgroundColor: segment.color }"
      ></div>
    </div>

    <ul class="storage-bar__legend">
      <li v-for="entry in legendEntries" :key="entry.label" class="storage-bar__legend-item">
        <span class="storage-bar__swatch" :style="{ backgroundColor: entry.color }" aria-hidden="true"></span>
        <span class="storage-bar__legend-label">{{ entry.label }}</span>
        <span class="storage-bar__legend-value">{{ formatBytes(entry.value) }}</span>
      </li>
    </ul>
  </div>
</template>
