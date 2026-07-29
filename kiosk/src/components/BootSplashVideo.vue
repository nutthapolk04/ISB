<script setup lang="ts">
import { onMounted, ref } from 'vue';

const emit = defineEmits<{ finished: [] }>();

const videoRef = ref<HTMLVideoElement | null>(null);

function finish() {
    emit('finished');
}

onMounted(() => {
    const video = videoRef.value;
    if (!video) {
        finish();
        return;
    }

    // Autoplay on Android WebView requires muted + playsinline.
    void video.play().catch(() => finish());
});
</script>

<template>
    <div class="boot-splash-video" aria-hidden="true">
        <video
            ref="videoRef"
            class="boot-splash-video__media"
            src="/splash-screen.mp4"
            autoplay
            muted
            playsinline
            preload="auto"
            @ended="finish"
            @error="finish"
        />
    </div>
</template>

<style scoped>
.boot-splash-video {
    position: fixed;
    inset: 0;
    z-index: 10002;
    background: #000;
    overflow: hidden;
}

.boot-splash-video__media {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
</style>
