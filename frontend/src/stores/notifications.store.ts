import { defineStore } from 'pinia'
import { ref } from 'vue'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export interface NotificationItem {
  id: number
  type: NotificationType
  message: string
}

export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref<NotificationItem[]>([])
  let nextId = 1

  function dismiss(id: number) {
    notifications.value = notifications.value.filter((notification) => notification.id !== id)
  }

  function push(message: string, type: NotificationType = 'info', duration = 5000) {
    const id = nextId++
    notifications.value.push({ id, type, message })

    if (duration > 0) {
      window.setTimeout(() => dismiss(id), duration)
    }

    return id
  }

  function clear() {
    notifications.value = []
  }

  return { notifications, push, dismiss, clear }
})
