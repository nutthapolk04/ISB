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
 * NK77 RS-232 per ICT104U Protocol (SWD-03, V0.5).
 * FM-3568D: /dev/ttyS2, 9600 8E1 (EVEN parity).
 *
 * Init (3.1 Power Up):
 * 1. Bill acceptor sends 0x80/0x8F every 2s until it receives 0x02 (stays Inhibit until then).
 * 2. Controller sends 0x02 within 2s → clears Inhibit.
 * 3. Controller sends 0x3E → enable acceptance (3.4 Enable/Disable).
 *
 * NOTE: 0x5B "model info" was REMOVED in ICT104U V0.5 — there is no model handshake.
 *
 * Poll (3.3): controller sends 0x0C → device replies 0x3E (enabled) / 0x5E (inhibit) / 0x20–0x2F (error).
 * Escrow (3.2): device sends 0x81 then 0x40–0x44 → controller sends 0x02 (accept) within 5s →
 *               device sends 0x10 (stacked) or 0x11 (rejected).
 */
class Nk77Reader(
    private val inputStream: InputStream,
    private val outputStream: OutputStream,
    private val onEvent: (BillEvent) -> Unit,
) : Runnable {

    private enum class InitState {
        WAIT_POWER,
        ENABLED,
    }

    @Volatile
    private var running = false

    @Volatile
    private var initState = InitState.WAIT_POWER

    @Volatile
    private var hostEnabled = false

    @Volatile
    private var powerUpEventEmitted = false

    @Volatile
    private var readyEventEmitted = false

    @Volatile
    private var enableScheduled = false

    private var thread: Thread? = null
    private var pollThread: Thread? = null
    private var enableThread: Thread? = null
    private var expectBillValue = false
    private val writeLock = Any()

    fun start() {
        if (running) return
        running = true
        resetState()
        startPollThread()
        thread = Thread(this, "nk77-reader").apply { start() }
    }

    fun stop() {
        running = false
        pollThread?.interrupt()
        pollThread = null
        enableThread?.interrupt()
        enableThread = null
        thread?.interrupt()
        thread = null
        resetState()
    }

    private fun resetState() {
        initState = InitState.WAIT_POWER
        hostEnabled = false
        powerUpEventEmitted = false
        readyEventEmitted = false
        enableScheduled = false
        expectBillValue = false
    }

    override fun run() {
        Log.i(TAG, "NK77 reader started — ICT104U 8E1 (0x80/0x8F → 0x02 → 0x3E → poll 0x0C)")

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

    private fun startPollThread() {
        pollThread?.interrupt()
        pollThread = Thread {
            while (running) {
                try {
                    Thread.sleep(POLL_INTERVAL_MS)
                    if (!running || initState != InitState.ENABLED) continue
                    sendCommand(CMD_STATUS_POLL)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }.apply {
            isDaemon = true
            name = "nk77-poll"
            start()
        }
    }

    /** 3.1: device sends 0x80/0x8F every 2s until it gets 0x02. ACK every one, then enable once. */
    private fun onPowerByte(hex: String) {
        if (!powerUpEventEmitted) {
            powerUpEventEmitted = true
            emit(BillEvent(type = "powerUp", rawHex = hex, message = "Bill acceptor power-up (0x$hex)"))
        }

        Log.i(TAG, "Power supply ON 0x$hex — ACK (0x02)")
        sendCommand(CMD_ACK)

        if (initState == InitState.WAIT_POWER) {
            scheduleEnable()
        }
    }

    /** After clearing Inhibit with 0x02, debounce then send 0x3E to enable acceptance. */
    private fun scheduleEnable() {
        synchronized(writeLock) {
            if (initState != InitState.WAIT_POWER || enableScheduled) return
            enableScheduled = true
        }

        enableThread?.interrupt()
        enableThread = Thread {
            try {
                Thread.sleep(ENABLE_DEBOUNCE_MS)
                if (!running || initState != InitState.WAIT_POWER) {
                    enableScheduled = false
                    return@Thread
                }
                initState = InitState.ENABLED
                Log.i(TAG, "Power up done — enable (0x3E) then poll (0x0C)")
                enableAcceptor("after power up")
                sendCommand(CMD_STATUS_POLL)
            } catch (_: InterruptedException) {
                // Rescheduled or stopped.
            }
        }.apply {
            isDaemon = true
            name = "nk77-enable"
            start()
        }
    }

    private fun enableAcceptor(reason: String) {
        sendCommand(CMD_ENABLE)
        hostEnabled = true
        Log.i(TAG, "Bill acceptor enabled (0x3E) — $reason")
        if (!readyEventEmitted) {
            readyEventEmitted = true
            emit(BillEvent(type = "ready", rawHex = "3E", message = "Bill acceptor ready — insert bill"))
        }
    }

    private fun handleBillValue(byte: Int, hex: String) {
        if (initState != InitState.ENABLED) {
            Log.w(TAG, "Bill value 0x$hex before enabled — ignored")
            return
        }

        val slot = byte - BILL_CODE_MIN + 1
        val amount = THB_DENOMINATIONS.getOrNull(byte - BILL_CODE_MIN)
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
            STATUS_ENABLED -> onPollEnabled()

            STATUS_INHIBIT -> onPollInhibited()

            CMD_ESCROW -> {
                if (initState != InitState.ENABLED) return
                expectBillValue = true
                emit(BillEvent(type = "escrowPending", rawHex = hex, message = "Bill validated (0x81) — waiting value"))
            }

            in BILL_CODE_MIN..BILL_CODE_MAX -> handleBillValue(byte, hex)

            CMD_STACK_OK -> emit(BillEvent(type = "stacked", rawHex = hex, message = "Bill stacked (0x10)"))

            CMD_REJECTED -> emit(BillEvent(type = "rejected", rawHex = hex, message = "Bill rejected / escrow timeout (0x11)"))

            in CMD_EXCEPTION_MIN..CMD_EXCEPTION_MAX -> {
                emit(BillEvent(type = "exception", billCode = byte, rawHex = hex, message = exceptionMessage(byte)))
                // 0x20 = Restart BA — re-run power up flow.
                if (byte == 0x20 && running && initState == InitState.ENABLED) {
                    Log.w(TAG, "Restart BA (0x20) — re-enabling")
                    hostEnabled = false
                    readyEventEmitted = false
                    initState = InitState.WAIT_POWER
                    enableScheduled = false
                }
            }

            else -> emit(BillEvent(type = "raw", rawHex = hex, message = "Unclassified byte 0x$hex"))
        }
    }

    private fun onPollEnabled() {
        Log.d(TAG, "Poll: enabled (0x3E)")
        hostEnabled = true
        if (!readyEventEmitted) {
            readyEventEmitted = true
            emit(BillEvent(type = "ready", rawHex = "3E", message = "Bill acceptor ready — insert bill"))
        }
    }

    private fun onPollInhibited() {
        Log.w(TAG, "Poll: inhibited (0x5E) — re-enabling (0x3E)")
        hostEnabled = false
        if (initState == InitState.ENABLED) {
            sendCommand(CMD_ENABLE)
            hostEnabled = true
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

        private const val ENABLE_DEBOUNCE_MS = 200L
        private const val POLL_INTERVAL_MS = 500L

        private const val CMD_ACK = 0x02
        private const val CMD_ACCEPT = 0x02
        private const val CMD_REJECT = 0x0F
        private const val CMD_STATUS_POLL = 0x0C
        private const val CMD_POWER_UP = 0x80
        private const val CMD_POWER_UP_ALT = 0x8F
        private const val CMD_ESCROW = 0x81
        private const val CMD_STACK_OK = 0x10
        private const val CMD_REJECTED = 0x11
        private const val CMD_ENABLE = 0x3E
        private const val CMD_DISABLE = 0x5E
        private const val STATUS_ENABLED = 0x3E
        private const val STATUS_INHIBIT = 0x5E
        private const val BILL_CODE_MIN = 0x40
        private const val BILL_CODE_MAX = 0x44
        private const val CMD_EXCEPTION_MIN = 0x20
        private const val CMD_EXCEPTION_MAX = 0x2F

        private val THB_DENOMINATIONS = intArrayOf(20, 50, 100, 500, 1000)
    }
}
