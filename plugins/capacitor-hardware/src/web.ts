import { WebPlugin } from '@capacitor/core';
import type { HardwarePlugin, PollStatusResult } from './definitions';

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

    async startCollecting(): Promise<void> {
        throw this.unimplemented('Not available on web');
    }

    async stopCollecting(): Promise<void> {
        throw this.unimplemented('Not available on web');
    }

    async acceptBill(): Promise<void> {
        throw this.unimplemented('Not available on web');
    }

    async returnBill(): Promise<void> {
        throw this.unimplemented('Not available on web');
    }

    async pollStatus(): Promise<PollStatusResult> {
        throw this.unimplemented('Not available on web');
    }

    async connectPrinter(): Promise<{ connected: boolean }> {
        throw this.unimplemented('Not available on web');
    }

    async disconnectPrinter(): Promise<void> {
        throw this.unimplemented('Not available on web');
    }

    async printRaw(): Promise<void> {
        throw this.unimplemented('Not available on web');
    }
}
