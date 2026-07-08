package com.okontek.plugins.hardware.printer

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build

/**
 * 80mm USB thermal receipt printer (RMC800 / ESC-POS class-7 printer).
 *
 * The printer enumerates as a USB device (e.g. /dev/bus/usb/001/004), so we talk to it through the
 * Android USB Host API (UsbManager + bulk transfer) rather than a serial UART. All ESC/POS encoding
 * is done JS-side; this class only claims the interface and pushes the byte payload to the bulk-OUT
 * endpoint.
 */
class PrinterManager(private val context: Context) {

    companion object {
        private const val ACTION_USB_PERMISSION = "com.okontek.plugins.hardware.USB_PERMISSION"
        private const val CHUNK_SIZE = 8192
        private const val WRITE_TIMEOUT_MS = 5000
    }

    private val usbManager: UsbManager =
        context.getSystemService(Context.USB_SERVICE) as UsbManager

    private var connection: UsbDeviceConnection? = null
    private var usbInterface: UsbInterface? = null
    private var endpointOut: UsbEndpoint? = null

    fun isConnected(): Boolean = connection != null && endpointOut != null

    /** Human-readable list of every attached USB device — used for diagnostics when detection fails. */
    fun describeDevices(): String {
        val devices = usbManager.deviceList.values
        if (devices.isEmpty()) return "no USB devices attached"
        return devices.joinToString("; ") { d ->
            val classes = (0 until d.interfaceCount).joinToString(",") {
                d.getInterface(it).interfaceClass.toString()
            }
            "vid=%04x pid=%04x ifaceClasses=[%s]".format(d.vendorId, d.productId, classes)
        }
    }

    private fun findPrinter(): UsbDevice? {
        val devices = usbManager.deviceList.values
        // Prefer a device that advertises the USB printer class (7).
        devices.firstOrNull { d ->
            (0 until d.interfaceCount).any {
                d.getInterface(it).interfaceClass == UsbConstants.USB_CLASS_PRINTER
            }
        }?.let { return it }
        // Fallback: first device exposing any bulk-OUT endpoint.
        return devices.firstOrNull { d -> bulkOutInterface(d) != null }
    }

    /** Return the interface/endpoint pair that has a bulk-OUT endpoint, or null. */
    private fun bulkOutInterface(device: UsbDevice): Pair<UsbInterface, UsbEndpoint>? {
        for (i in 0 until device.interfaceCount) {
            val iface = device.getInterface(i)
            for (e in 0 until iface.endpointCount) {
                val ep = iface.getEndpoint(e)
                if (ep.direction == UsbConstants.USB_DIR_OUT &&
                    ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK
                ) {
                    return iface to ep
                }
            }
        }
        return null
    }

    /**
     * Locate the printer and open it. If USB permission is missing, request it and complete
     * asynchronously via [onResult]. [onResult] is always called exactly once.
     */
    fun connect(onResult: (connected: Boolean, error: String?) -> Unit) {
        disconnect()
        val device = findPrinter()
        if (device == null) {
            onResult(false, "No USB printer found (${describeDevices()})")
            return
        }
        if (usbManager.hasPermission(device)) {
            openDevice(device, onResult)
        } else {
            requestPermission(device, onResult)
        }
    }

    private fun requestPermission(device: UsbDevice, onResult: (Boolean, String?) -> Unit) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (intent.action != ACTION_USB_PERMISSION) return
                context.unregisterReceiver(this)
                val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                if (granted) {
                    openDevice(device, onResult)
                } else {
                    onResult(false, "USB permission denied for the printer")
                }
            }
        }

        val filter = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }

        val flags =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val pending = PendingIntent.getBroadcast(
            context, 0, Intent(ACTION_USB_PERMISSION).setPackage(context.packageName), flags,
        )
        usbManager.requestPermission(device, pending)
    }

    private fun openDevice(device: UsbDevice, onResult: (Boolean, String?) -> Unit) {
        val pair = bulkOutInterface(device)
        if (pair == null) {
            onResult(false, "Printer has no bulk-OUT endpoint")
            return
        }
        val (iface, ep) = pair
        val conn = usbManager.openDevice(device)
        if (conn == null) {
            onResult(false, "Failed to open USB printer connection")
            return
        }
        if (!conn.claimInterface(iface, true)) {
            conn.close()
            onResult(false, "Failed to claim printer interface")
            return
        }
        connection = conn
        usbInterface = iface
        endpointOut = ep
        onResult(true, null)
    }

    @Synchronized
    fun disconnect() {
        try {
            usbInterface?.let { connection?.releaseInterface(it) }
            connection?.close()
        } catch (_: Exception) {
            // Best-effort.
        }
        connection = null
        usbInterface = null
        endpointOut = null
    }

    /** Write a fully-built ESC/POS payload to the printer's bulk-OUT endpoint. */
    @Synchronized
    fun write(bytes: ByteArray) {
        val conn = connection ?: throw IllegalStateException("Printer is not connected")
        val ep = endpointOut ?: throw IllegalStateException("Printer endpoint unavailable")
        var offset = 0
        while (offset < bytes.size) {
            val len = minOf(CHUNK_SIZE, bytes.size - offset)
            val sent = conn.bulkTransfer(ep, bytes.copyOfRange(offset, offset + len), len, WRITE_TIMEOUT_MS)
            if (sent < 0) throw IllegalStateException("bulkTransfer failed at offset $offset")
            offset += sent
        }
    }
}
