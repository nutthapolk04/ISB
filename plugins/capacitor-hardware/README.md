# capacitor-hardware

plugin for kiosk with nk77 bill acceptor

## Install

To use npm

```bash
npm install capacitor-hardware
````

To use yarn

```bash
yarn add capacitor-hardware
```

Sync native files

```bash
npx cap sync
```

## API

<docgen-index>

* [`getPlatform()`](#getplatform)
* [`connect(...)`](#connect)
* [`disconnect()`](#disconnect)
* [`startCollecting(...)`](#startcollecting)
* [`stopCollecting()`](#stopcollecting)
* [`acceptBill()`](#acceptbill)
* [`returnBill()`](#returnbill)
* [`connectPrinter()`](#connectprinter)
* [`disconnectPrinter()`](#disconnectprinter)
* [`printRaw(...)`](#printraw)
* [`addListener('billEvent', ...)`](#addlistenerbillevent-)
* [Interfaces](#interfaces)
* [Type Aliases](#type-aliases)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

### getPlatform()

```typescript
getPlatform() => Promise<{ platform: string; }>
```

**Returns:** <code>Promise&lt;{ platform: string; }&gt;</code>

--------------------


### connect(...)

```typescript
connect(options: ConnectOptions) => Promise<{ connected: boolean; }>
```

| Param         | Type                                                      |
| ------------- | --------------------------------------------------------- |
| **`options`** | <code><a href="#connectoptions">ConnectOptions</a></code> |

**Returns:** <code>Promise&lt;{ connected: boolean; }&gt;</code>

--------------------


### disconnect()

```typescript
disconnect() => Promise<void>
```

--------------------


### startCollecting(...)

```typescript
startCollecting(options: { targetThb: number; }) => Promise<void>
```

Begin a top-up session: enable the bill acceptor and reset the running total.
Bills are auto-accepted while the running total stays within `targetThb`; a bill that
would exceed it is held in escrow and surfaced via an `overpayPending` event.

| Param         | Type                                |
| ------------- | ----------------------------------- |
| **`options`** | <code>{ targetThb: number; }</code> |

--------------------


### stopCollecting()

```typescript
stopCollecting() => Promise<void>
```

End the session and inhibit the acceptor so no further bills are taken.

--------------------


### acceptBill()

```typescript
acceptBill() => Promise<void>
```

Accept the bill currently held in escrow (resolves an `overpayPending` prompt).

--------------------


### returnBill()

```typescript
returnBill() => Promise<void>
```

Return the bill currently held in escrow (resolves an `overpayPending` prompt).

--------------------


### connectPrinter()

```typescript
connectPrinter() => Promise<{ connected: boolean; }>
```

Detect and open the 80mm USB thermal receipt printer (auto-detects the USB
printer-class device and requests USB permission if needed).

**Returns:** <code>Promise&lt;{ connected: boolean; }&gt;</code>

--------------------


### disconnectPrinter()

```typescript
disconnectPrinter() => Promise<void>
```

Close the printer serial connection.

--------------------


### printRaw(...)

```typescript
printRaw(options: { data: string; }) => Promise<void>
```

Write a pre-built ESC/POS payload to the printer.
`data` is the base64-encoded raw byte stream (raster image, feed, cut, etc.);
all receipt encoding happens on the JS side.

| Param         | Type                           |
| ------------- | ------------------------------ |
| **`options`** | <code>{ data: string; }</code> |

--------------------


### addListener('billEvent', ...)

```typescript
addListener(eventName: 'billEvent', listenerFunc: (event: BillEvent) => void) => Promise<PluginListenerHandle>
```

| Param              | Type                                                                |
| ------------------ | ------------------------------------------------------------------- |
| **`eventName`**    | <code>'billEvent'</code>                                            |
| **`listenerFunc`** | <code>(event: <a href="#billevent">BillEvent</a>) =&gt; void</code> |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

--------------------


### Interfaces


#### ConnectOptions

| Prop           | Type                |
| -------------- | ------------------- |
| **`port`**     | <code>string</code> |
| **`baudRate`** | <code>number</code> |


#### PluginListenerHandle

| Prop         | Type                                      |
| ------------ | ----------------------------------------- |
| **`remove`** | <code>() =&gt; Promise&lt;void&gt;</code> |


#### BillEvent

| Prop                | Type                                                    | Description                                                                          |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **`type`**          | <code><a href="#billeventtype">BillEventType</a></code> |                                                                                      |
| **`rawHex`**        | <code>string</code>                                     |                                                                                      |
| **`billSlot`**      | <code>number</code>                                     |                                                                                      |
| **`billCode`**      | <code>number</code>                                     |                                                                                      |
| **`billAmountThb`** | <code>number</code>                                     | Approximate THB of the bill this event refers to — depends on NK77 slot programming. |
| **`collectedThb`**  | <code>number</code>                                     | Running total (THB) stacked so far in the current collecting session.                |
| **`targetThb`**     | <code>number</code>                                     | Target amount (THB) for the current collecting session.                              |
| **`message`**       | <code>string</code>                                     |                                                                                      |


### Type Aliases


#### BillEventType

<code>'powerUp' | 'ready' | 'collecting' | 'escrowPending' | 'accepted' | 'overpayPending' | 'stacked' | 'returned' | 'collectComplete' | 'rejected' | 'exception' | 'raw' | 'error'</code>

</docgen-api>
