import { WebPlugin } from '@capacitor/core';
import type { HardwarePlugin } from './definitions';

export class HardwareWeb extends WebPlugin implements HardwarePlugin {
    async getPlatform() {
        return {
            platform: 'web',
        };
    }
}
