package com.okontek.plugins.hardware

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import android.util.Base64
import com.okontek.plugins.hardware.billacceptor.BillEvent
import com.okontek.plugins.hardware.printer.PrinterManager
import com.okontek.plugins.hardware.serial.SerialManager

@CapacitorPlugin(name = "Hardware")
class HardwarePlugin : Plugin() {

    private val serialManager = SerialManager()
    private val printerManager by lazy { PrinterManager(context) }

    @PluginMethod
    fun getPlatform(call: PluginCall) {
        val ret = JSObject()
        ret.put("platform", "android")
        call.resolve(ret)
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val port = call.getString("port") ?: call.getString("path")
        val baudRate = call.getInt("baudRate")

        if (port == null || baudRate == null) {
            call.reject("port and baudRate are required")
            return
        }

        try {
            serialManager.connect(port, baudRate, ::emitBillEvent)
            val ret = JSObject()
            ret.put("connected", serialManager.isConnected())
            call.resolve(ret)
        } catch (e: Throwable) {
            val message = e.message ?: "Failed to connect to serial port"
            val cause = if (e is Exception) e else Exception(e)
            call.reject(message, cause)
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        try {
            serialManager.disconnect()
            call.resolve()
        } catch (e: Throwable) {
            val message = e.message ?: "Failed to disconnect serial port"
            val cause = if (e is Exception) e else Exception(e)
            call.reject(message, cause)
        }
    }

    @PluginMethod
    fun startCollecting(call: PluginCall) {
        val targetThb = call.getInt("targetThb")
        if (targetThb == null || targetThb <= 0) {
            call.reject("targetThb must be a positive number")
            return
        }
        try {
            serialManager.startCollecting(targetThb)
            call.resolve()
        } catch (e: Throwable) {
            val message = e.message ?: "Failed to start collecting"
            val cause = if (e is Exception) e else Exception(e)
            call.reject(message, cause)
        }
    }

    @PluginMethod
    fun stopCollecting(call: PluginCall) {
        try {
            serialManager.stopCollecting()
            call.resolve()
        } catch (e: Throwable) {
            val message = e.message ?: "Failed to stop collecting"
            val cause = if (e is Exception) e else Exception(e)
            call.reject(message, cause)
        }
    }

    @PluginMethod
    fun acceptBill(call: PluginCall) {
        try {
            serialManager.acceptBill()
            call.resolve()
        } catch (e: Throwable) {
            val message = e.message ?: "Failed to accept bill"
            val cause = if (e is Exception) e else Exception(e)
            call.reject(message, cause)
        }
    }

    @PluginMethod
    fun returnBill(call: PluginCall) {
        try {
            serialManager.returnBill()
            call.resolve()
        } catch (e: Throwable) {
            val message = e.message ?: "Failed to return bill"
            val cause = if (e is Exception) e else Exception(e)
            call.reject(message, cause)
        }
    }

    @PluginMethod
    fun connectPrinter(call: PluginCall) {
        try {
            // USB printer detection + permission may be async (permission dialog).
            printerManager.connect { connected, error ->
                if (connected) {
                    val ret = JSObject()
                    ret.put("connected", true)
                    call.resolve(ret)
                } else {
                    call.reject(error ?: "Failed to connect to printer")
                }
            }
        } catch (e: Throwable) {
            val message = e.message ?: "Failed to connect to printer"
            val cause = if (e is Exception) e else Exception(e)
            call.reject(message, cause)
        }
    }

    @PluginMethod
    fun disconnectPrinter(call: PluginCall) {
        try {
            printerManager.disconnect()
            call.resolve()
        } catch (e: Throwable) {
            val message = e.message ?: "Failed to disconnect printer"
            val cause = if (e is Exception) e else Exception(e)
            call.reject(message, cause)
        }
    }

    @PluginMethod
    fun printRaw(call: PluginCall) {
        val data = call.getString("data")
        if (data == null) {
            call.reject("data (base64 ESC/POS payload) is required")
            return
        }
        try {
            val bytes = Base64.decode(data, Base64.DEFAULT)
            printerManager.write(bytes)
            call.resolve()
        } catch (e: Throwable) {
            val message = e.message ?: "Failed to print"
            val cause = if (e is Exception) e else Exception(e)
            call.reject(message, cause)
        }
    }

    private fun emitBillEvent(event: BillEvent) {
        val payload = JSObject()
        payload.put("type", event.type)
        payload.put("rawHex", event.rawHex)
        event.billSlot?.let { payload.put("billSlot", it) }
        event.billCode?.let { payload.put("billCode", it) }
        event.billAmountThb?.let { payload.put("billAmountThb", it) }
        event.collectedThb?.let { payload.put("collectedThb", it) }
        event.targetThb?.let { payload.put("targetThb", it) }
        event.message?.let { payload.put("message", it) }

        val activity = activity
        if (activity != null) {
            activity.runOnUiThread { notifyListeners("billEvent", payload) }
        } else {
            notifyListeners("billEvent", payload)
        }
    }
}
