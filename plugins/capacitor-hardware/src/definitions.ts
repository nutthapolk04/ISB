export interface HardwarePlugin {
    getPlatform(): Promise<{ platform: string }>;
}
