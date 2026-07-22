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

export type BillPollStatus = 'enabled' | 'inhibited' | 'error' | 'timeout' | 'unknown';

export interface PollStatusResult {
    statusHex: string;
    status: BillPollStatus;
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

    /**
     * Send one ICT status poll (0x0C) and return the acceptor's reply.
     * For technician / debug use — the background poll loop runs automatically after init.
     */
    pollStatus(): Promise<PollStatusResult>;

    /**
     * Detect and open the 80mm USB thermal receipt printer (auto-detects the USB
     * printer-class device and requests USB permission if needed).
     */
    connectPrinter(): Promise<{ connected: boolean }>;

    /** Close the printer serial connection. */
    disconnectPrinter(): Promise<void>;

    /**
     * Write a pre-built ESC/POS payload to the printer.
     * `data` is the base64-encoded raw byte stream (raster image, feed, cut, etc.);
     * all receipt encoding happens on the JS side.
     */
    printRaw(options: { data: string }): Promise<void>;

    addListener(
        eventName: 'billEvent',
        listenerFunc: (event: BillEvent) => void,
    ): Promise<PluginListenerHandle>;
}
