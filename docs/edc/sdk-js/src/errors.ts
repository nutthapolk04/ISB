import type { DeviceInfo, AcceptedDevice } from "./types.js";

export class UnsupportedDeviceError extends Error {
  readonly device: DeviceInfo;
  readonly acceptedDevices: AcceptedDevice[];

  constructor(device: DeviceInfo, accepted: AcceptedDevice[]) {
    const acceptedStr = accepted
      .map(d => `${d.brand}/${d.protocol}`)
      .join(", ");
    super(
      `Device ${device.brand}/${device.protocol} is not in the accepted list: [${acceptedStr}]`
    );
    this.name = "UnsupportedDeviceError";
    this.device = device;
    this.acceptedDevices = accepted;
  }
}

export class UnsupportedCapabilityError extends Error {
  readonly capability: string;
  readonly available: string[];

  constructor(capability: string, available: string[]) {
    super(
      `Capability "${capability}" is not supported by this device. ` +
      `Available: [${available.join(", ")}]`
    );
    this.name = "UnsupportedCapabilityError";
    this.capability = capability;
    this.available = available;
  }
}

export class EdcError extends Error {
  readonly responseCode: string;
  readonly fields: Record<string, string>;

  constructor(code: string, fields: Record<string, string>) {
    super(`EDC returned response code: ${code}`);
    this.name = "EdcError";
    this.responseCode = code;
    this.fields = fields;
  }
}
