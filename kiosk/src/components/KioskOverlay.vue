<script setup lang="ts">
defineProps<{
    message?: string;
}>();
</script>

<template>
    <div class="kiosk-overlay" aria-live="polite" aria-busy="true">
        <div class="kiosk-spinner" />
        <p v-if="message" class="kiosk-overlay-msg">{{ message }}</p>
    </div>
</template>
