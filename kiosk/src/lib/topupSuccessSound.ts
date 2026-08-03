const SUCCESS_AUDIO_SRC = '/success.mp3';

let successAudio: HTMLAudioElement | null = null;

function getSuccessAudio(): HTMLAudioElement {
    if (!successAudio) {
        successAudio = new Audio(SUCCESS_AUDIO_SRC);
        successAudio.preload = 'auto';
        successAudio.volume = 1;
        successAudio.load();
    }
    return successAudio;
}

/** Play kiosk top-up success chime (kiosk/public/success.mp3). */
export function playTopupSuccessSound(): void {
    try {
        const audio = getSuccessAudio();
        audio.currentTime = 0;
        void audio.play().catch((e) => {
            console.warn('[TopUp] success sound playback failed:', e);
        });
    } catch (e) {
        console.warn('[TopUp] success sound failed:', e);
    }
}

export function stopTopupSuccessSound(): void {
    if (!successAudio) return;
    successAudio.pause();
    successAudio.currentTime = 0;
}
