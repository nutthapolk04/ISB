<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import svgPaths from '../lib/splash/isb-svg-paths';
import letterBPaths from '../lib/splash/isb-letter-b-paths';
import './boot-splash.css';

const emit = defineEmits<{ finished: [] }>();

const SUBTITLE_PATHS = [
    svgPaths.p14e0c600, svgPaths.p1c8f6500, svgPaths.p1deb4780,
    svgPaths.p35c0d80, svgPaths.p353ff280, svgPaths.p2dcd3980,
    svgPaths.p25a76a00, svgPaths.p16cbf500, svgPaths.p18cf3800,
    svgPaths.p19504a00, svgPaths.p231cc0c0, svgPaths.p6e2da00,
    svgPaths.p8993700, svgPaths.p1557ad00, svgPaths.p26c05380,
    svgPaths.p21226600, svgPaths.p2258fcf0, svgPaths.p5222c0,
    svgPaths.p27e73380, svgPaths.p24993e80, svgPaths.p22d94580,
    svgPaths.p2df62200, svgPaths.p2236b8f0, svgPaths.p55b1900,
    svgPaths.pce80e80, svgPaths.pe7ea00,
];

const LOGO_VIEW_W = 1728;
const LOGO_VIEW_H = 663.184;
const GOLD_KEYFRAMES_ID = 'bs-gold-keyframes';
const SPLASH_AUDIO_SRC = '/splash-vid.mp3';

const stageRef = ref<HTMLElement | null>(null);
const goldWrapperRef = ref<HTMLElement | null>(null);
const splashRootRef = ref<HTMLElement | null>(null);

const ANIM_END_MS = 3950;
const FINAL_SPINNER_MS = 2500;

let doneTimer: ReturnType<typeof setTimeout> | undefined;
let goldEndY = 0;
let splashAudio: HTMLAudioElement | null = null;
let audioUnlockCleanup: (() => void) | null = null;
let audioRetryTimers: number[] = [];

function freezeSplashFrame() {
    const root = splashRootRef.value;
    if (!root) return;

    const animated = root.querySelectorAll(
        '.anim-gold, .anim-red, .anim-letter-I, .anim-letter-S, .anim-letter-B, '
        + '.anim-top-shrink, .anim-subtitle, .boot-splash__spinner-wrap, '
        + '.boot-splash__final-spinner-wrap, .boot-splash__stage',
    );

    animated.forEach((el) => {
        const computed = getComputedStyle(el);
        const htmlEl = el as HTMLElement;
        htmlEl.style.animation = 'none';
        htmlEl.style.transition = 'none';
        if (computed.transform !== 'none') {
            htmlEl.style.transform = computed.transform;
        }
        htmlEl.style.opacity = computed.opacity;
    });

    const goldWrapper = goldWrapperRef.value;
    if (goldWrapper) {
        goldWrapper.style.animation = 'none';
        goldWrapper.style.transform = `translateX(-50%) translateY(${goldEndY}px)`;
    }
}

function finishSplash() {
    stopSplashAudio();
    freezeSplashFrame();
    requestAnimationFrame(() => emit('finished'));
}

function getSplashAudio() {
    if (!splashAudio) {
        splashAudio = new Audio(SPLASH_AUDIO_SRC);
        splashAudio.preload = 'auto';
        splashAudio.volume = 1;
        splashAudio.load();
    }
    return splashAudio;
}

async function tryPlaySplashAudio() {
    const audio = getSplashAudio();
    if (!audio.paused && audio.currentTime > 0) return true;

    try {
        audio.muted = false;
        await audio.play();
        return true;
    } catch (err) {
        console.warn('[BootSplash] audio play blocked:', err);
        return false;
    }
}

function startSplashAudio() {
    const audio = getSplashAudio();

    const attemptPlay = () => {
        void tryPlaySplashAudio().then((played) => {
            if (played) clearAudioUnlockListeners();
        });
    };

    if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        attemptPlay();
    } else {
        audio.addEventListener('canplaythrough', attemptPlay, { once: true });
    }

    const unlock = () => attemptPlay();
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('keydown', unlock, { once: true, capture: true });
    audioUnlockCleanup = () => {
        document.removeEventListener('pointerdown', unlock, { capture: true });
        document.removeEventListener('keydown', unlock, { capture: true });
    };

    audioRetryTimers.push(
        window.setTimeout(attemptPlay, 150),
        window.setTimeout(attemptPlay, 500),
    );
}

function clearAudioUnlockListeners() {
    audioUnlockCleanup?.();
    audioUnlockCleanup = null;
}

function stopSplashAudio() {
    clearAudioUnlockListeners();
    audioRetryTimers.forEach((id) => window.clearTimeout(id));
    audioRetryTimers = [];

    if (!splashAudio) return;
    splashAudio.pause();
    splashAudio.currentTime = 0;
}

function setupGoldRise() {
    const stage = stageRef.value;
    const goldWrapper = goldWrapperRef.value;
    if (!stage || !goldWrapper) return;

    const stageRect = stage.getBoundingClientRect();
    goldWrapper.style.width = `${stageRect.width}px`;
    goldWrapper.style.height = `${stageRect.height}px`;

    // Fixed at bottom:0 — translate up until wrapper aligns with the centered stage.
    const endY = stageRect.top - window.innerHeight + stageRect.height;
    goldEndY = endY;

    let style = document.getElementById(GOLD_KEYFRAMES_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = GOLD_KEYFRAMES_ID;
        document.head.appendChild(style);
    }

    style.textContent = `
        @keyframes bs-gold-rise {
            0% { transform: translateX(-50%) translateY(2000px); }
            60% { transform: translateX(-50%) translateY(calc(${endY}px - 6px)); }
            80% { transform: translateX(-50%) translateY(calc(${endY}px + 3px)); }
            100% { transform: translateX(-50%) translateY(${endY}px); }
        }
    `;
}

function cleanupGoldKeyframes() {
    document.getElementById(GOLD_KEYFRAMES_ID)?.remove();
}

onMounted(async () => {
    await nextTick();
    setupGoldRise();
    startSplashAudio();

    doneTimer = setTimeout(finishSplash, ANIM_END_MS + FINAL_SPINNER_MS);
});

onUnmounted(() => {
    if (doneTimer) clearTimeout(doneTimer);
    stopSplashAudio();
    cleanupGoldKeyframes();
});
</script>

<template>
    <div ref="splashRootRef" class="boot-splash" aria-hidden="true">
        <div class="boot-splash__spinner-wrap">
            <div class="boot-splash__spinner" />
        </div>

        <div ref="goldWrapperRef" class="boot-splash__gold-fixed anim-gold">
            <div class="boot-splash__gold-content anim-top-shrink">
                <svg :viewBox="`0 0 ${LOGO_VIEW_W} ${LOGO_VIEW_H}`" fill="none"
                    xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <clipPath id="boot-splash-gold-clip">
                            <rect :width="LOGO_VIEW_W" :height="LOGO_VIEW_H" />
                        </clipPath>
                        <mask id="boot-splash-mask-gold" height="394" maskUnits="userSpaceOnUse"
                            style="mask-type: alpha" width="739" x="494" y="6">
                            <path :d="svgPaths.p3bd5f480" fill="#D9D9D9" />
                        </mask>
                    </defs>
                    <g clip-path="url(#boot-splash-gold-clip)">
                        <g mask="url(#boot-splash-mask-gold)">
                            <path clip-rule="evenodd" d="M863.5 0L473 400H863.5V0Z" fill="#F5C400"
                                fill-rule="evenodd" />
                            <path d="M1254 400L863.5 0V400H1254Z" fill="#EEA903" />
                        </g>
                    </g>
                </svg>
            </div>
        </div>

        <div ref="stageRef" class="boot-splash__stage">
            <div class="boot-splash__logo-wrap">
                <div class="boot-splash__flare" aria-hidden="true" />
                <svg :viewBox="`0 0 ${LOGO_VIEW_W} ${LOGO_VIEW_H}`" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <clipPath id="boot-splash-clip">
                            <rect :width="LOGO_VIEW_W" :height="LOGO_VIEW_H" />
                        </clipPath>
                        <mask id="boot-splash-mask-red" height="193" maskUnits="userSpaceOnUse" style="mask-type: alpha"
                            width="362" x="683" y="72">
                            <path :d="svgPaths.p8e3d700" fill="#D9D9D9" />
                        </mask>
                    </defs>

                    <g clip-path="url(#boot-splash-clip)">
                        <g class="anim-top-shrink">
                            <g class="anim-red">
                                <g mask="url(#boot-splash-mask-red)">
                                    <path clip-rule="evenodd" :d="svgPaths.p2ef6fa00" fill="#E41D1C"
                                        fill-rule="evenodd" />
                                    <path :d="svgPaths.p23c1c200" fill="#BF2D2B" />
                                </g>
                            </g>

                            <g class="anim-letter-I">
                                <path :d="svgPaths.p3cd58200" fill="#32261C" />
                            </g>

                            <g class="anim-letter-S">
                                <path :d="svgPaths.pd6cc600" fill="#32261C" />
                            </g>

                            <g class="anim-letter-B">
                                <g transform="translate(901, 298)">
                                    <path clip-rule="evenodd" :d="letterBPaths.p3420f200" fill="#32261C"
                                        fill-rule="evenodd" />
                                </g>
                            </g>
                        </g>

                        <g class="anim-subtitle">
                            <path v-for="(d, i) in SUBTITLE_PATHS" :key="i" :d="d" fill="#32261C" />
                        </g>
                    </g>
                </svg>
            </div>
        </div>

        <div class="boot-splash__final-spinner-wrap">
            <div class="boot-splash__spinner" />
        </div>
    </div>
</template>
