const BYTE_UNITS = ['КБ', 'МБ', 'ГБ', 'ТБ']

/** Форматирует размер в байтах человекочитаемой строкой (Б/КБ/МБ/ГБ/ТБ). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} Б`
  }
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex += 1
  } while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1)
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${BYTE_UNITS[unitIndex]}`
}

/** Длительность в секундах → метка «м:сс»; null/бессмыслица → «—». */
export function formatDuration(duration: number | null): string {
  if (duration === null) {
    return '—'
  }
  const totalSeconds = Math.max(0, Math.round(duration))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}
