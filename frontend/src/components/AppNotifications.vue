<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useNotificationsStore } from '@/stores/notifications.store'

const notificationsStore = useNotificationsStore()
const { notifications } = storeToRefs(notificationsStore)
</script>

<template>
  <div class="notification-list" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="notification">
      <div
        v-for="notification in notifications"
        :key="notification.id"
        class="notification"
        :class="`notification--${notification.type}`"
        role="status"
      >
        <span>{{ notification.message }}</span>
        <button
          class="notification__dismiss"
          type="button"
          aria-label="Закрыть уведомление"
          @click="notificationsStore.dismiss(notification.id)"
        >
          ×
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
