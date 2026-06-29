import type { PluginListenerHandle } from '@capacitor/core';

export interface ConnectOptions {
    port: string;
    baudRate: number;
}

export type BillEventType =
    | 'powerUp'
    | 'escrowPending'
    | 'escrow'
    | 'stacked'
    | 'stackFailed'
    | 'exception'
    | 'raw'
    | 'error';

export interface BillEvent {
    type: BillEventType;
    rawHex: string;
    billSlot?: number;
    billCode?: number;
    /** Approximate THB — depends on NK77 slot programming. */
    billAmountThb?: number;
    message?: string;
}

export interface HardwarePlugin {
    getPlatform(): Promise<{ platform: string }>;

    connect(options: ConnectOptions): Promise<{ connected: boolean }>;

    disconnect(): Promise<void>;

    addListener(
        eventName: 'billEvent',
        listenerFunc: (event: BillEvent) => void,
    ): Promise<PluginListenerHandle>;
}
