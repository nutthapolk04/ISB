import type { PluginListenerHandle } from '@capacitor/core';

export interface ConnectOptions {
    port: string;
    baudRate: number;
}

export type BillEventType =
    | 'powerUp'
    | 'ready'
    | 'collecting'
    | 'escrowPending'
    | 'accepted'
    | 'overpayPending'
    | 'stacked'
    | 'returned'
    | 'collectComplete'
    | 'rejected'
    | 'exception'
    | 'raw'
    | 'error';

export interface BillEvent {
    type: BillEventType;
    rawHex: string;
    billSlot?: number;
    billCode?: number;
    /** Approximate THB of the bill this event refers to — depends on NK77 slot programming. */
    billAmountThb?: number;
    /** Running total (THB) stacked so far in the current collecting session. */
    collectedThb?: number;
    /** Target amount (THB) for the current collecting session. */
    targetThb?: number;
    message?: string;
}

export interface HardwarePlugin {
    getPlatform(): Promise<{ platform: string }>;

    connect(options: ConnectOptions): Promise<{ connected: boolean }>;

    disconnect(): Promise<void>;

    /**
     * Begin a top-up session: enable the bill acceptor and reset the running total.
     * Bills are auto-accepted while the running total stays within `targetThb`; a bill that
     * would exceed it is held in escrow and surfaced via an `overpayPending` event.
     */
    startCollecting(options: { targetThb: number }): Promise<void>;

    /** End the session and inhibit the acceptor so no further bills are taken. */
    stopCollecting(): Promise<void>;

    /** Accept the bill currently held in escrow (resolves an `overpayPending` prompt). */
    acceptBill(): Promise<void>;

    /** Return the bill currently held in escrow (resolves an `overpayPending` prompt). */
    returnBill(): Promise<void>;

    addListener(
        eventName: 'billEvent',
        listenerFunc: (event: BillEvent) => void,
    ): Promise<PluginListenerHandle>;
}
