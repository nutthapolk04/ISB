package com.okontek.plugins.hardware.billacceptor

import android.os.SystemClock
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
 * NK77 RS-232 (ICT104U family). FM-3568D: /dev/ttyS2, 9600 8E1 (EVEN parity).
 *
 * Init:
 * 1. Passively WAIT for the device's power-up handshake 0x80/0x8F.
 * 2. Reply 0x02 within 2s (clears Inhibit), then send 0x3E (enable) — this runs ONCE.
 * 3. If no 0x80/0x8F within 3s (device already powered), poll 0x0C — a 0x3E reply means
 *    the BA is already enabled; a 0x5E reply means inhibit → we send 0x3E.
 *
 * Escrow (3.2): device sends 0x81 then 0x40–0x44 → controller sends 0x02 (accept) within 5s →
 *               device sends 0x10 (stacked) or 0x11 (rejected).
 *
 * NOTE: 0x5B "model info" was REMOVED in ICT104U V0.5 — there is no model handshake.
 */
class Nk77Reader(
    private val inputStream: InputStream,
    private val outputStream: OutputStream,
    private val onEvent: (BillEvent) -> Unit,
) : Runnable {

    @Volatile
    private var running = false

    @Volatile
    private var powerUpEventEmitted = false

    @Volatile
    private var initDone = false

    private var expectBillValue = false
    private var lastBillSlot: Int? = null
    private var lastBillCode: Int? = null
    private var lastBillAmountThb: Int? = null

    private var thread: Thread? = null
    private var promptThread: Thread? = null
    private val writeLock = Any()

    fun start() {
        if (running) return
        running = true
        resetState()
        thread = Thread(this, "nk77-reader").apply { start() }
        startStatusPrompt()
    }

    fun stop() {
        running = false
        promptThread?.interrupt()
        promptThread = null
        thread?.interrupt()
        thread = null
        resetState()
    }

    private fun resetState() {
        powerUpEventEmitted = false
        initDone = false
        expectBillValue = false
        clearLastBill()
    }

    private fun clearLastBill() {
        lastBillSlot = null
        lastBillCode = null
        lastBillAmountThb = null
    }

    override fun run() {
        Log.i(TAG, "NK77 reader started — ICT104U (init → accept bills → stack)")

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
                    emit(BillEvent(type = "error", rawHex = "", message = e.message ?: "Serial read error"))
                }
                break
            }
        }
        Log.i(TAG, "NK77 reader stopped")
    }

    /**
     * If no 0x80/0x8F arrives within 3s (device already powered from a previous session),
     * poll with 0x0C — the BA replies 0x3E (enabled) or 0x5E (inhibit). Repeats until init completes.
     */
    private fun startStatusPrompt() {
        promptThread?.interrupt()
        promptThread = Thread {
            var n = 0
            try {
                while (running && !initDone) {
                    Thread.sleep(STATUS_PROMPT_MS)
                    if (!running || initDone) break
                    n++
                    Log.i(TAG, "No 0x80/0x8F for ${STATUS_PROMPT_MS}ms — poll (0x30) #$n")
                    sendCommand(CMD_STATUS_POLL)
                }
            } catch (_: InterruptedException) {
                // Handshake or status reply completed init, or reader stopped.
            }
        }.apply {
            isDaemon = true
            name = "nk77-status-prompt"
            start()
        }
    }

    private fun finishInit(reason: String) {
        if (initDone) return
        initDone = true
        promptThread?.interrupt()
        promptThread = null
        Log.i(TAG, "Init done ($reason)")
        emit(BillEvent(type = "ready", rawHex = "3E", message = "Bill acceptor ready — insert bill"))
    }

    /** 3.1 Power Up: device sends 0x80/0x8F every 2s until it gets 0x02. ACK it, then enable once. */
    private fun onPowerByte(hex: String) {
        if (!powerUpEventEmitted) {
            powerUpEventEmitted = true
            emit(BillEvent(type = "powerUp", rawHex = hex, message = "Bill acceptor power-up (0x$hex)"))
        }

        Log.i(TAG, "RX 0x$hex — ACK (0x02)")
        sendCommand(CMD_ACK)

        if (!initDone) {
            Log.i(TAG, "Enable (0x3E)")
            sendCommand(CMD_ENABLE)
            finishInit("handshake 0x$hex")
        }
    }

    /** 3.3 poll reply: BA already enabled. */
    private fun onPollEnabled(hex: String) {
        Log.d(TAG, "Poll: enabled (0x3E)")
        if (!initDone) {
            finishInit("poll status 0x$hex")
        }
    }

    /** 3.3 poll reply: BA inhibited — re-enable. */
    private fun onPollInhibited() {
        Log.w(TAG, "Poll: inhibited (0x5E) — enable (0x3E)")
        sendCommand(CMD_ENABLE)
        if (!initDone) {
            finishInit("poll inhibit → enable")
        }
    }

    /** 3.2 Escrow: accept bill within 5s by sending 0x02. */
    private fun handleBillValue(byte: Int, hex: String) {
        if (!initDone) {
            Log.w(TAG, "Bill value 0x$hex before init — ignored")
            return
        }

        val slot = byte - BILL_CODE_MIN + 1
        val amount = THB_DENOMINATIONS.getOrNull(byte - BILL_CODE_MIN)
        lastBillSlot = slot
        lastBillCode = byte
        lastBillAmountThb = amount

        Log.i(TAG, "Bill value 0x$hex — accept (0x02)${amount?.let { " (~$it THB)" } ?: ""}")
        sendCommand(CMD_ACCEPT)

        emit(
            BillEvent(
                type = "escrow",
                billSlot = slot,
                billCode = byte,
                billAmountThb = amount,
                rawHex = hex,
                message = amount?.let { "Bill ~$it THB (0x$hex)" } ?: "Bill slot $slot (0x$hex)",
            ),
        )
    }

    private fun handleByte(byte: Int) {
        val hex = "%02X".format(byte)

        if (byte == 0x00) {
            Log.d(TAG, "RX 0x00 (ignored)")
            return
        }

        Log.d(TAG, "RX 0x$hex @ ${nowMs()} ms")

        if (byte == CMD_POWER_UP || byte == CMD_POWER_UP_ALT) {
            onPowerByte(hex)
            return
        }

        if (expectBillValue) {
            expectBillValue = false
            if (byte in BILL_CODE_MIN..BILL_CODE_MAX) {
                handleBillValue(byte, hex)
            } else {
                emit(BillEvent(type = "raw", rawHex = hex, message = "Unexpected byte after escrow 0x81: 0x$hex"))
            }
            return
        }

        when (byte) {
            STATUS_ENABLED -> onPollEnabled(hex)

            STATUS_INHIBIT -> onPollInhibited()

            CMD_ESCROW -> {
                if (!initDone) return
                expectBillValue = true
                Log.i(TAG, "Bill validated (0x81) — waiting value")
                emit(BillEvent(type = "escrowPending", rawHex = hex, message = "Bill validated (0x81) — waiting value"))
            }

            in BILL_CODE_MIN..BILL_CODE_MAX -> handleBillValue(byte, hex)

            CMD_STACK_OK -> {
                val amount = lastBillAmountThb
                Log.i(TAG, "Bill stacked (0x10)${amount?.let { " — $it THB" } ?: ""}")
                emit(
                    BillEvent(
                        type = "stacked",
                        billSlot = lastBillSlot,
                        billCode = lastBillCode,
                        billAmountThb = amount,
                        rawHex = hex,
                        message = amount?.let { "Bill stacked — $it THB" } ?: "Bill stacked (0x10)",
                    ),
                )
                clearLastBill()
            }

            CMD_REJECTED -> {
                Log.w(TAG, "Bill rejected / escrow timeout (0x11)")
                emit(
                    BillEvent(
                        type = "rejected",
                        billSlot = lastBillSlot,
                        billCode = lastBillCode,
                        billAmountThb = lastBillAmountThb,
                        rawHex = hex,
                        message = "Bill rejected / escrow timeout (0x11)",
                    ),
                )
                clearLastBill()
            }

            in CMD_EXCEPTION_MIN..CMD_EXCEPTION_MAX -> {
                val msg = exceptionMessage(byte)
                Log.w(TAG, "Exception 0x$hex — $msg")
                emit(BillEvent(type = "exception", billCode = byte, rawHex = hex, message = msg))
            }

            else -> {
                Log.d(TAG, "Unclassified byte 0x$hex")
                emit(BillEvent(type = "raw", rawHex = hex, message = "Unclassified byte 0x$hex"))
            }
        }
    }

    private fun sendCommand(vararg bytes: Int) {
        synchronized(writeLock) {
            try {
                val payload = ByteArray(bytes.size) { bytes[it].toByte() }
                outputStream.write(payload)
                outputStream.flush()
                Log.d(TAG, "TX ${payload.joinToString(" ") { "%02X".format(it) }} @ ${nowMs()} ms")
            } catch (e: IOException) {
                Log.w(TAG, "Serial write error", e)
                emit(BillEvent(type = "error", rawHex = "", message = e.message ?: "Serial write error"))
            }
        }
    }

    private fun emit(event: BillEvent) {
        onEvent(event)
    }

    private fun nowMs(): Long = SystemClock.elapsedRealtime()

    private fun exceptionMessage(code: Int): String {
        return when (code) {
            0x20 -> "Restart BA"
            0x21 -> "Motor failure"
            0x22 -> "Checksum error"
            0x23 -> "Bill jam"
            0x24 -> "Bill remove"
            0x25 -> "Stacker open"
            0x27 -> "Sensor problem"
            0x28 -> "Bill fish"
            0x29 -> "Stacker problem"
            0x2A -> "Bill reject"
            0x2E -> "Invalid command"
            else -> "Status code 0x${"%02X".format(code)}"
        }
    }

    companion object {
        private const val TAG = "Nk77Reader"

        private const val STATUS_PROMPT_MS = 3_000L

        private const val CMD_ACK = 0x02
        private const val CMD_ACCEPT = 0x02
        private const val CMD_DECLINE = 0x0F
        private const val CMD_ENABLE = 0x3E
        private const val CMD_STATUS_POLL = 0x30
        private const val CMD_POWER_UP = 0x80
        private const val CMD_POWER_UP_ALT = 0x8F
        private const val CMD_ESCROW = 0x81
        private const val CMD_STACK_OK = 0x10
        private const val CMD_REJECTED = 0x11
        private const val STATUS_ENABLED = 0x3E
        private const val STATUS_INHIBIT = 0x5E
        private const val BILL_CODE_MIN = 0x40
        private const val BILL_CODE_MAX = 0x44
        private const val CMD_EXCEPTION_MIN = 0x20
        private const val CMD_EXCEPTION_MAX = 0x2F

        private val THB_DENOMINATIONS = intArrayOf(20, 50, 100, 500, 1000)
    }
}
