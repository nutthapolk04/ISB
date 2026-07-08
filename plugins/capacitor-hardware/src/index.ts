import { registerPlugin } from '@capacitor/core';
import type { HardwarePlugin } from './definitions';

export const Hardware = registerPlugin<HardwarePlugin>('Hardware', {
    web: () => import('./web').then((m) => new m.HardwareWeb()),
});

export * from './definitions';
