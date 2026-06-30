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

| Prop                | Type                                                    | Description                                         |
| ------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| **`type`**          | <code><a href="#billeventtype">BillEventType</a></code> |                                                     |
| **`rawHex`**        | <code>string</code>                                     |                                                     |
| **`billSlot`**      | <code>number</code>                                     |                                                     |
| **`billCode`**      | <code>number</code>                                     |                                                     |
| **`billAmountThb`** | <code>number</code>                                     | Approximate THB — depends on NK77 slot programming. |
| **`message`**       | <code>string</code>                                     |                                                     |


### Type Aliases


#### BillEventType

<code>'powerUp' | 'ready' | 'escrowPending' | 'escrow' | 'stacked' | 'stackFailed' | 'rejected' | 'exception' | 'raw' | 'error'</code>

</docgen-api>
