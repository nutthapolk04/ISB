import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.okontek.app',
    appName: 'Kiosk Balance App',
    webDir: 'dist'

    server: {
        url: "https://isb-kiosk.vercel.app/"
        cleartext: false
    }
};

export default config;

