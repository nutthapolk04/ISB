import { WebPlugin } from '@capacitor/core';
import type { HardwarePlugin } from './definitions';

export class HardwareWeb extends WebPlugin implements HardwarePlugin {
    async getPlatform() {
        return { platform: 'web' };
    }

    async connect(): Promise<{ connected: boolean }> {
        throw this.unimplemented('Not available on web');
    }

    async disconnect(): Promise<void> {
        throw this.unimplemented('Not available on web');
    }
}
