<script setup lang="ts">
import AppNotifications from './components/AppNotifications.vue'
</script>

<template>
  <svg class="svg-defs" aria-hidden="true" focusable="false">
    <filter id="liquid-displacement" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feImage
        href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAWUlEQVRYw+3YwQ3AMAgEQbC//8kZQpJIy7l9d6n7Q+kDdECBB0DgARD4AAT+OzDmnpNqT8peTdH3njeVvpnVN5V2mdU3lXaZ1TeVdpnVN5V2mdU3lXaZ1TdnHXbe+QMXh9UCsJPkvQAAAABJRU5ErkJggg=="
        preserveAspectRatio="none"
        result="turbulence"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="turbulence"
        scale="60"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  </svg>
  <RouterView />
  <AppNotifications />
</template>

<style>
.svg-defs {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
}
</style>
