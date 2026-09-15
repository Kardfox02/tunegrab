import { defineStore } from 'pinia'
import { ref } from 'vue'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export interface NotificationItem {
  id: number
  type: NotificationType
  message: string
  // Число слитых повторов той же связки message+type (>=1 показывается).
  repeats: number
}

// Оверхед тостов ограничен: «шторм» ошибок из падающего поллера не должен
// создавать тысячи DOM-нод.
const MAX_NOTIFICATIONS = 30

export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref<NotificationItem[]>([])
  let nextId = 1
  const timeouts = new Map<number, ReturnType<typeof window.setTimeout>>()

  function dismissTimer(id: number): void {
    const timer = timeouts.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timeouts.delete(id)
    }
  }

  function push(message: string, type: NotificationType = 'info', duration = 5000): number {
    // Дедуп: если тост с такой же связкой message+type уже висит, новый вызов
    // увеличивает счётчик повторов и продлевает таймер существующего тоста,
    // вместо создания новой DOM-ноды.
    for (const existing of notifications.value) {
      if (existing.message === message && existing.type === type) {
        existing.repeats += 1
        dismissTimer(existing.id)
        timeouts.set(existing.id, window.setTimeout(() => dismiss(existing.id), duration))
        return existing.id
      }
    }

    const id = nextId++
    notifications.value.push({ id, type, message, repeats: 1 })

    // Cap: самые старые тосты вытесняются при переполнении.
    while (notifications.value.length > MAX_NOTIFICATIONS) {
      const oldest = notifications.value.shift()
      if (oldest) {
        dismissTimer(oldest.id)
      }
    }

    if (duration > 0) {
      timeouts.set(id, window.setTimeout(() => dismiss(id), duration))
    }

    return id
  }

  function dismiss(id: number) {
    dismissTimer(id)
    notifications.value = notifications.value.filter((notification) => notification.id !== id)
  }

  function clear() {
    for (const [, timer] of timeouts) {
      window.clearTimeout(timer)
    }
    timeouts.clear()
    notifications.value = []
  }

  return { notifications, push, dismiss, clear }
})
