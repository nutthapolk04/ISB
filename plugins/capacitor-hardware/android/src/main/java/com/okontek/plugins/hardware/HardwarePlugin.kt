package com.okontek.plugins.hardware

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.okontek.plugins.hardware.billacceptor.BillEvent
import com.okontek.plugins.hardware.serial.SerialManager

@CapacitorPlugin(name = "Hardware")
class HardwarePlugin : Plugin() {

    private val serialManager = SerialManager()

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

    private fun emitBillEvent(event: BillEvent) {
        val payload = JSObject()
        payload.put("type", event.type)
        payload.put("rawHex", event.rawHex)
        event.billSlot?.let { payload.put("billSlot", it) }
        event.billCode?.let { payload.put("billCode", it) }
        event.billAmountThb?.let { payload.put("billAmountThb", it) }
        event.message?.let { payload.put("message", it) }

        val activity = activity
        if (activity != null) {
            activity.runOnUiThread { notifyListeners("billEvent", payload) }
        } else {
            notifyListeners("billEvent", payload)
        }
    }
}
