package com.okontek.plugins.hardware.serial

import com.okontek.plugins.hardware.billacceptor.BillEvent
import com.okontek.plugins.hardware.billacceptor.Nk77Reader
import com.okontek.plugins.hardware.native.SerialPort
import java.io.File

class SerialManager {

    private var connected = false
    private var serialPort: SerialPort? = null
    private var reader: Nk77Reader? = null

    @Synchronized
    fun connect(port: String, baudRate: Int, onBillEvent: (BillEvent) -> Unit) {
        disconnect()

        val portFile = SerialPort(File(port), baudRate, 0)
        serialPort = portFile
        reader = Nk77Reader(portFile.inputStream, portFile.outputStream, onBillEvent)
        reader?.start()
        connected = true
    }

    @Synchronized
    fun disconnect() {
        reader?.stop()
        reader = null
        try {
            serialPort?.close()
        } catch (_: Exception) {
            // Best-effort close.
        }
        serialPort = null
        connected = false
    }

    fun isConnected(): Boolean {
        return connected && serialPort != null
    }
}
