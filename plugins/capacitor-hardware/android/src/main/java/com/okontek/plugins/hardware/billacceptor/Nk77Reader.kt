package com.okontek.plugins.hardware.billacceptor

import android.util.Log
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

data class BillEvent(
    val type: String,
    val billSlot: Int? = null,
    val billCode: Int? = null,
    val billAmountThb: Int? = null,
    val rawHex: String,
    val message: String? = null,
)

/**
 * ICT RS-232 protocol for NK77 bill acceptor (docs/kiosk wiring: TTY S1, NK77-RS232-1-0).
 */
class Nk77Reader(
    private val inputStream: InputStream,
    private val outputStream: OutputStream,
    private val onEvent: (BillEvent) -> Unit,
) : Runnable {

    @Volatile
    private var running = false

    private var thread: Thread? = null
    private var expectBillValue = false

    fun start() {
        if (running) return
        running = true
        thread = Thread(this, "nk77-reader").apply { start() }
        sendCommand(CMD_ENABLE)
        Log.i(TAG, "NK77 reader started, sent enable (0x3E)")
    }

    fun stop() {
        running = false
        thread?.interrupt()
        thread = null
        expectBillValue = false
    }

    override fun run() {
        val buffer = ByteArray(64)
        while (running) {
            try {
                val read = inputStream.read(buffer)
                if (read < 0) break
                if (read == 0) continue
                for (i in 0 until read) {
                    handleByte(buffer[i].toInt() and 0xFF)
                }
            } catch (e: IOException) {
                if (running) {
                    Log.w(TAG, "Serial read error", e)
                    emit(
                        BillEvent(
                            type = "error",
                            rawHex = "",
                            message = e.message ?: "Serial read error",
                        ),
                    )
                }
                break
            }
        }
        Log.i(TAG, "NK77 reader stopped")
    }

    private fun handleByte(byte: Int) {
        val hex = "%02X".format(byte)
        Log.d(TAG, "RX 0x$hex")

        if (expectBillValue) {
            expectBillValue = false
            if (byte in BILL_CODE_MIN..BILL_CODE_MAX) {
                val slot = byte - BILL_CODE_MIN + 1
                val amount = THB_DENOMINATIONS.getOrNull(byte - BILL_CODE_MIN)
                sendCommand(CMD_ACCEPT)
                emit(
                    BillEvent(
                        type = "escrow",
                        billSlot = slot,
                        billCode = byte,
                        billAmountThb = amount,
                        rawHex = hex,
                        message = amount?.let { "Bill slot $slot (~$it THB)" }
                            ?: "Bill slot $slot (code 0x$hex)",
                    ),
                )
            } else {
                emit(
                    BillEvent(
                        type = "raw",
                        rawHex = hex,
                        message = "Unexpected byte after escrow: 0x$hex",
                    ),
                )
            }
            return
        }

        when (byte) {
            CMD_POWER_UP -> {
                sendCommand(CMD_ACK)
                emit(
                    BillEvent(
                        type = "powerUp",
                        rawHex = hex,
                        message = "Bill acceptor power-up handshake",
                    ),
                )
            }

            CMD_ESCROW -> {
                expectBillValue = true
                emit(
                    BillEvent(
                        type = "escrowPending",
                        rawHex = hex,
                        message = "Bill validated, waiting for denomination code",
                    ),
                )
            }

            CMD_STACK_OK -> emit(
                BillEvent(
                    type = "stacked",
                    rawHex = hex,
                    message = "Bill stacked successfully",
                ),
            )

            CMD_STACK_FAIL -> emit(
                BillEvent(
                    type = "stackFailed",
                    rawHex = hex,
                    message = "Bill stack failed",
                ),
            )

            in CMD_EXCEPTION_MIN..CMD_EXCEPTION_MAX -> emit(
                BillEvent(
                    type = "exception",
                    billCode = byte,
                    rawHex = hex,
                    message = exceptionMessage(byte),
                ),
            )

            else -> emit(
                BillEvent(
                    type = "raw",
                    rawHex = hex,
                    message = "Unclassified byte 0x$hex",
                ),
            )
        }
    }

    private fun sendCommand(vararg bytes: Int) {
        try {
            val payload = ByteArray(bytes.size) { bytes[it].toByte() }
            outputStream.write(payload)
            outputStream.flush()
            Log.d(TAG, "TX ${payload.joinToString(" ") { "%02X".format(it) }}")
        } catch (e: IOException) {
            Log.w(TAG, "Serial write error", e)
            emit(
                BillEvent(
                    type = "error",
                    rawHex = "",
                    message = e.message ?: "Serial write error",
                ),
            )
        }
    }

    private fun emit(event: BillEvent) {
        onEvent(event)
    }

    private fun exceptionMessage(code: Int): String {
        return when (code) {
            0x22 -> "Bill jam"
            0x29 -> "Bill rejected"
            0x26 -> "Communication failure"
            else -> "Exception code 0x${"%02X".format(code)}"
        }
    }

    companion object {
        private const val TAG = "Nk77Reader"

        private const val CMD_ACK = 0x02
        private const val CMD_ACCEPT = 0x02
        private const val CMD_POWER_UP = 0x80
        private const val CMD_ESCROW = 0x81
        private const val CMD_STACK_OK = 0x10
        private const val CMD_STACK_FAIL = 0x11
        private const val CMD_ENABLE = 0x3E
        private const val BILL_CODE_MIN = 0x40
        private const val BILL_CODE_MAX = 0x44
        private const val CMD_EXCEPTION_MIN = 0x20
        private const val CMD_EXCEPTION_MAX = 0x2F

        private val THB_DENOMINATIONS = intArrayOf(20, 50, 100, 500, 1000)
    }
}
