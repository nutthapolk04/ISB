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
 * Observe-only mode (debugging):
 * 1. Passively WAIT for the device's power-up handshake 0x80/0x8F.
 * 2. Reply 0x02 within 2s (clears Inhibit), then send 0x3E (enable) — this runs ONCE.
 * 3. After that, just LOG whatever the device sends. We do NOT auto-accept bills
 *    (no 0x02 on escrow) yet — purely observation.
 *
 * Per ICT104U V0.5 the BA only sends 0x80/0x8F right after power-on (every 2s until it gets
 * 0x02); if it was already powered and previously ACKed, it stays silent. To recover from that
 * (e.g. the app restarted against an already-running device) without power-cycling, if we don't
 * see 0x80/0x8F within 3s we poll with 0x0C — the BA answers 0x80/0x8F and we resume init.
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
    }

    override fun run() {
        Log.i(TAG, "NK77 reader started — observe-only (wait 0x80/0x8F → 0x02 → 0x3E once; poll 0x0C after 3s, then log)")

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
     * poll with 0x0C — the BA replies 0x80/0x8F and init resumes, no power-cycle needed.
     * Repeats every 3s until init completes.
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
                    Log.i(TAG, "No 0x80/0x8F for ${STATUS_PROMPT_MS}ms — poll (0x0C) #$n to wake device")
                    sendCommand(CMD_STATUS_POLL)
                }
            } catch (_: InterruptedException) {
                // Handshake arrived, or reader stopped.
            }
        }.apply {
            isDaemon = true
            name = "nk77-status-prompt"
            start()
        }
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
            initDone = true
            promptThread?.interrupt()
            promptThread = null
            Log.i(TAG, "Enable (0x3E) — init done, now observing")
            sendCommand(CMD_ENABLE)
            emit(BillEvent(type = "ready", rawHex = "3E", message = "Bill acceptor ready — insert bill"))
        }
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

        // Observe-only: classify for readable logs, but DO NOT respond to the device yet.
        if (expectBillValue) {
            expectBillValue = false
            val msg = if (byte in BILL_CODE_MIN..BILL_CODE_MAX) {
                val amount = THB_DENOMINATIONS.getOrNull(byte - BILL_CODE_MIN)
                "Bill value 0x$hex${amount?.let { " (~$it THB)" } ?: ""} (observe only — not accepting)"
            } else {
                "Unexpected byte after escrow 0x81: 0x$hex"
            }
            Log.i(TAG, msg)
            emit(BillEvent(type = "log", billCode = byte, rawHex = hex, message = msg))
            return
        }

        val msg = when (byte) {
            STATUS_ENABLED -> "Status: enabled (0x3E)"
            STATUS_INHIBIT -> "Status: inhibit (0x5E)"
            CMD_ESCROW -> {
                expectBillValue = true
                "Bill validated (0x81) — waiting value"
            }
            in BILL_CODE_MIN..BILL_CODE_MAX -> {
                val amount = THB_DENOMINATIONS.getOrNull(byte - BILL_CODE_MIN)
                "Bill value 0x$hex${amount?.let { " (~$it THB)" } ?: ""} (observe only — not accepting)"
            }
            CMD_STACK_OK -> "Bill stacked (0x10)"
            CMD_REJECTED -> "Bill rejected / escrow timeout (0x11)"
            in CMD_EXCEPTION_MIN..CMD_EXCEPTION_MAX -> exceptionMessage(byte)
            else -> "Unclassified byte 0x$hex"
        }

        Log.i(TAG, "RX 0x$hex — $msg")
        emit(BillEvent(type = "log", billCode = byte, rawHex = hex, message = msg))
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

        // If no power-up handshake (0x80/0x8F) shows up in this window, poll 0x0C to wake the BA.
        private const val STATUS_PROMPT_MS = 3_000L

        private const val CMD_ACK = 0x02
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
