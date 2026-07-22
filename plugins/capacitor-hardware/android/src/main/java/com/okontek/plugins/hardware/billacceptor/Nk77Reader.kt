package com.okontek.plugins.hardware.billacceptor

import android.os.SystemClock
import android.util.Log
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Result of a manual or on-demand status poll (0x0C). */
data class BillPollResult(
    val statusHex: String,
    val status: String,
    val message: String? = null,
)

data class BillEvent(
    val type: String,
    val billSlot: Int? = null,
    val billCode: Int? = null,
    val billAmountThb: Int? = null,
    val collectedThb: Int? = null,
    val targetThb: Int? = null,
    val rawHex: String,
    val message: String? = null,
)

/**
 * NK77 RS-232 (ICT104U family). FM-3568D: /dev/ttyS2, 9600 8E1 (EVEN parity).
 *
 * Init:
 * 1. Passively WAIT for the device's power-up handshake 0x80/0x8F.
 * 2. Reply 0x02 (clears Inhibit), then send 0x3E (enable), then disable (0x5E) — bezel stays
 *    inhibited until a top-up session starts. Init runs ONCE.
 * 3. If no 0x80/0x8F within 3s (device already powered), send 0x30 (Reset) to force a fresh
 *    power-up handshake.
 *
 * Collecting session (top-up):
 * - startCollecting(target): enable (0x3E), reset counters.
 * - Bill in escrow (3.2: 0x81 → 0x40–0x44):
 *     amount < MIN_ACCEPTED_THB (฿100) → decline (0x0F) — ฿20 / ฿50 returned.
 *     collected + bill <= target → accept (0x02) → stacked (0x10) → add to collected.
 *     collected + bill  > target → hold (0x18, freezes the 5s clock) → emit overpayPending;
 *                                  JS decides via acceptBill() (0x02) or returnBill() (0x0F).
 * - stopCollecting(): disable (0x5E).
 *
 * Polling (ICT104U §3.3):
 * - After init, a background thread sends 0x0C every POLL_INTERVAL_MS so the acceptor stays
 *   responsive and reports escrow / status bytes.
 * - pollStatus() sends a one-shot 0x0C and waits up to POLL_STATUS_TIMEOUT_MS for the reply.
 *
 * A bill that stacks (0x10) is in the cashbox and CANNOT be returned — only bills still in
 * escrow can be returned (0x0F).
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

    @Volatile
    private var collecting = false

    @Volatile
    private var targetThb = 0

    @Volatile
    private var collectedThb = 0

    private var expectBillValue = false

    // The bill currently in escrow (set when its value byte arrives).
    private var escrowSlot: Int? = null
    private var escrowCode: Int? = null
    private var escrowThb: Int? = null
    // True while an over-target bill is held (0x18) awaiting a JS decision.
    @Volatile
    private var awaitingOverpayDecision = false

    private var thread: Thread? = null
    private var promptThread: Thread? = null
    private var pollThread: Thread? = null
    private val writeLock = Any()
    private val stateLock = Any()
    private val pollWaitLock = Any()
    private var pollWaiter: PollWaiter? = null

    private class PollWaiter(val latch: CountDownLatch) {
        var statusByte: Int? = null
    }

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
        stopPollLoop()
        thread?.interrupt()
        thread = null
        resetState()
    }

    // --- JS-driven session control (called from the plugin/bridge thread) ---

    /** Begin a top-up session: enable the acceptor and reset the running total. */
    fun startCollecting(target: Int) {
        synchronized(stateLock) {
            targetThb = target
            collectedThb = 0
            collecting = true
            awaitingOverpayDecision = false
            clearEscrow()
        }
        Log.i(TAG, "startCollecting(target=$target THB) — enable (0x3E)")
        sendCommand(CMD_ENABLE)
        sendCommand(CMD_STATUS_POLL)
        emit(BillEvent(type = "collecting", targetThb = target, collectedThb = 0, rawHex = "3E", message = "Collecting up to $target THB"))
    }

    /**
     * Send one status poll (0x0C) and wait for the next status byte.
     * Intended for technician / debug use from the Capacitor bridge.
     */
    fun pollStatus(timeoutMs: Long = POLL_STATUS_TIMEOUT_MS): BillPollResult {
        val waiter = PollWaiter(CountDownLatch(1))
        synchronized(pollWaitLock) {
            pollWaiter = waiter
            Log.i(TAG, "pollStatus — TX 0x0C (timeout=${timeoutMs}ms)")
            sendCommand(CMD_STATUS_POLL)
        }
        try {
            val got = waiter.latch.await(timeoutMs, TimeUnit.MILLISECONDS)
            val byte = waiter.statusByte
            return when {
                byte != null -> {
                    val hex = "%02X".format(byte)
                    val status = interpretPollStatus(byte)
                    val message = pollStatusMessage(byte)
                    Log.i(TAG, "pollStatus — RX 0x$hex ($status)")
                    BillPollResult(statusHex = hex, status = status, message = message)
                }
                got -> BillPollResult(statusHex = "", status = "timeout", message = "Poll completed without status byte")
                else -> BillPollResult(statusHex = "", status = "timeout", message = "No response within ${timeoutMs}ms")
            }
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            return BillPollResult(statusHex = "", status = "timeout", message = e.message ?: "Poll interrupted")
        } finally {
            synchronized(pollWaitLock) {
                if (pollWaiter === waiter) pollWaiter = null
            }
        }
    }

    /** End the session: inhibit the acceptor so no further bills are taken. */
    fun stopCollecting() {
        synchronized(stateLock) {
            collecting = false
            awaitingOverpayDecision = false
            clearEscrow()
        }
        Log.i(TAG, "stopCollecting — disable (0x5E)")
        sendCommand(CMD_DISABLE)
    }

    /** Accept the bill currently held in escrow (0x02). Used to resolve an overpay prompt. */
    fun acceptBill() {
        synchronized(stateLock) {
            if (escrowThb == null) {
                Log.w(TAG, "acceptBill: no bill in escrow")
                return
            }
            awaitingOverpayDecision = false
        }
        Log.i(TAG, "acceptBill — accept (0x02)")
        sendCommand(CMD_ACCEPT)
    }

    /** Return the bill currently held in escrow (0x0F). Used to resolve an overpay prompt. */
    fun returnBill() {
        synchronized(stateLock) {
            awaitingOverpayDecision = false
        }
        Log.i(TAG, "returnBill — decline (0x0F)")
        sendCommand(CMD_DECLINE)
    }

    private fun resetState() {
        synchronized(stateLock) {
            powerUpEventEmitted = false
            initDone = false
            expectBillValue = false
            collecting = false
            targetThb = 0
            collectedThb = 0
            awaitingOverpayDecision = false
            clearEscrow()
        }
    }

    private fun clearEscrow() {
        escrowSlot = null
        escrowCode = null
        escrowThb = null
    }

    override fun run() {
        Log.i(TAG, "NK77 reader started — ICT104U (session-based accept/hold/return)")

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
     * send 0x30 (Reset) to force a clean power-up handshake. Repeats until init completes.
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
                    Log.i(TAG, "No 0x80/0x8F for ${STATUS_PROMPT_MS}ms — reset (0x30) #$n")
                    sendCommand(CMD_RESET)
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
        Log.i(TAG, "Init done ($reason) — disable (0x5E) until a session starts")
        // Keep the bezel inhibited until a top-up session explicitly starts.
        sendCommand(CMD_DISABLE)
        startPollLoop()
        emit(BillEvent(type = "ready", rawHex = "3E", message = "Bill acceptor ready"))
    }

    /** ICT104U §3.3 — periodic 0x0C keeps the acceptor communicating during idle and collecting. */
    private fun startPollLoop() {
        stopPollLoop()
        pollThread = Thread {
            try {
                pollLoop@ while (running && initDone) {
                    Thread.sleep(POLL_INTERVAL_MS)
                    if (!running || !initDone) break
                    synchronized(pollWaitLock) {
                        if (pollWaiter != null) continue@pollLoop
                        sendCommand(CMD_STATUS_POLL)
                    }
                }
            } catch (_: InterruptedException) {
                // Reader stopped or poll loop restarted.
            }
        }.apply {
            isDaemon = true
            name = "nk77-poll"
            start()
        }
    }

    private fun stopPollLoop() {
        pollThread?.interrupt()
        pollThread = null
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
        } else if (collecting) {
            // Re-assert enable after a mid-session power blip.
            sendCommand(CMD_ENABLE)
        }
    }

    /** 3.3 poll reply: BA enabled. */
    private fun onPollEnabled(hex: String, byte: Int) {
        notifyPollResponse(byte)
        Log.d(TAG, "Poll: enabled (0x3E)")
        if (!initDone) {
            finishInit("poll status 0x$hex")
        }
    }

    /** 3.3 poll reply: BA inhibited. */
    private fun onPollInhibited(byte: Int) {
        notifyPollResponse(byte)
        Log.d(TAG, "Poll: inhibited (0x5E)")
        if (!initDone) {
            // Device answered → it's alive. Enable, then init will disable until a session.
            sendCommand(CMD_ENABLE)
            finishInit("poll inhibit → enable")
        } else if (collecting) {
            // Should be enabled during a session — re-assert.
            Log.w(TAG, "Inhibited mid-session — re-enable (0x3E)")
            sendCommand(CMD_ENABLE)
        }
    }

    private fun notifyPollResponse(byte: Int) {
        synchronized(pollWaitLock) {
            pollWaiter?.let { waiter ->
                waiter.statusByte = byte
                waiter.latch.countDown()
            }
        }
    }

    private fun interpretPollStatus(byte: Int): String {
        return when (byte) {
            STATUS_ENABLED -> "enabled"
            STATUS_INHIBIT -> "inhibited"
            in CMD_EXCEPTION_MIN..CMD_EXCEPTION_MAX -> "error"
            else -> "unknown"
        }
    }

    private fun pollStatusMessage(byte: Int): String {
        return when (byte) {
            STATUS_ENABLED -> "Bill acceptor enabled (0x3E)"
            STATUS_INHIBIT -> "Bill acceptor inhibited (0x5E)"
            in CMD_EXCEPTION_MIN..CMD_EXCEPTION_MAX -> exceptionMessage(byte)
            else -> "Unclassified poll response 0x${"%02X".format(byte)}"
        }
    }

    /** 3.2 Escrow value byte: decide accept / hold based on the running total vs target. */
    private fun handleBillValue(byte: Int, hex: String) {
        if (!initDone) {
            Log.w(TAG, "Bill value 0x$hex before init — ignored")
            return
        }

        val slot = byte - BILL_CODE_MIN + 1
        val amount = THB_DENOMINATIONS.getOrNull(byte - BILL_CODE_MIN)

        if (!collecting) {
            // No active session — return any inserted bill.
            Log.w(TAG, "Bill 0x$hex outside a session — decline (0x0F)")
            sendCommand(CMD_DECLINE)
            return
        }

        if (amount == null) {
            Log.w(TAG, "Unknown denomination 0x$hex — decline (0x0F)")
            sendCommand(CMD_DECLINE)
            return
        }

        // Policy: accept ฿100 / ฿500 / ฿1000 only — return ฿20 and ฿50.
        if (amount < MIN_ACCEPTED_THB) {
            Log.w(TAG, "Bill ~$amount THB below minimum ($MIN_ACCEPTED_THB) — decline (0x0F)")
            synchronized(stateLock) {
                escrowSlot = slot
                escrowCode = byte
                escrowThb = amount
            }
            sendCommand(CMD_DECLINE)
            // Device replies 0x11 → onReturned(); keep escrow until then.
            return
        }

        val wouldBe: Int
        val overTarget: Boolean
        synchronized(stateLock) {
            escrowSlot = slot
            escrowCode = byte
            escrowThb = amount
            wouldBe = collectedThb + amount
            overTarget = wouldBe > targetThb
            if (overTarget) awaitingOverpayDecision = true
        }

        if (!overTarget) {
            Log.i(TAG, "Bill ~$amount THB — accept (0x02), total would be $wouldBe/$targetThb")
            sendCommand(CMD_ACCEPT)
            emit(
                BillEvent(
                    type = "accepted",
                    billSlot = slot,
                    billCode = byte,
                    billAmountThb = amount,
                    collectedThb = collectedThb,
                    targetThb = targetThb,
                    rawHex = hex,
                    message = "Accepting ~$amount THB",
                ),
            )
        } else {
            Log.i(TAG, "Bill ~$amount THB would exceed target ($wouldBe/$targetThb) — hold (0x18)")
            sendCommand(CMD_HOLD)
            emit(
                BillEvent(
                    type = "overpayPending",
                    billSlot = slot,
                    billCode = byte,
                    billAmountThb = amount,
                    collectedThb = collectedThb,
                    targetThb = targetThb,
                    rawHex = hex,
                    message = "Bill ~$amount THB exceeds target — hold for decision",
                ),
            )
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
            STATUS_ENABLED -> onPollEnabled(hex, byte)

            STATUS_INHIBIT -> onPollInhibited(byte)

            CMD_ESCROW -> {
                if (!initDone) return
                expectBillValue = true
                Log.i(TAG, "Bill validated (0x81) — waiting value")
                emit(BillEvent(type = "escrowPending", rawHex = hex, message = "Bill validated (0x81) — waiting value"))
            }

            in BILL_CODE_MIN..BILL_CODE_MAX -> handleBillValue(byte, hex)

            CMD_STACK_OK -> onStacked(hex)

            CMD_REJECTED -> onReturned(hex)

            in CMD_EXCEPTION_MIN..CMD_EXCEPTION_MAX -> {
                notifyPollResponse(byte)
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

    /** 0x10: the escrowed bill went into the cashbox — add it to the running total. */
    private fun onStacked(hex: String) {
        val slot: Int?
        val code: Int?
        val amount: Int?
        val total: Int
        val target: Int
        val complete: Boolean
        synchronized(stateLock) {
            slot = escrowSlot
            code = escrowCode
            amount = escrowThb
            if (amount != null) collectedThb += amount
            total = collectedThb
            target = targetThb
            complete = collecting && total >= target && target > 0
            clearEscrow()
        }

        Log.i(TAG, "Bill stacked (0x10)${amount?.let { " — $it THB" } ?: ""}, total $total/$target")
        emit(
            BillEvent(
                type = "stacked",
                billSlot = slot,
                billCode = code,
                billAmountThb = amount,
                collectedThb = total,
                targetThb = target,
                rawHex = hex,
                message = amount?.let { "Bill stacked — $it THB (total $total)" } ?: "Bill stacked (total $total)",
            ),
        )

        if (complete) {
            Log.i(TAG, "Target reached ($total/$target) — disable (0x5E)")
            synchronized(stateLock) { collecting = false }
            sendCommand(CMD_DISABLE)
            emit(BillEvent(type = "collectComplete", collectedThb = total, targetThb = target, rawHex = hex, message = "Collected $total THB"))
        }
    }

    /** 0x11: the escrowed bill was returned to the customer (declined / timeout). */
    private fun onReturned(hex: String) {
        val slot: Int?
        val code: Int?
        val amount: Int?
        val total: Int
        val target: Int
        synchronized(stateLock) {
            slot = escrowSlot
            code = escrowCode
            amount = escrowThb
            total = collectedThb
            target = targetThb
            clearEscrow()
        }

        Log.i(TAG, "Bill returned (0x11)${amount?.let { " — $it THB" } ?: ""}")
        emit(
            BillEvent(
                type = "returned",
                billSlot = slot,
                billCode = code,
                billAmountThb = amount,
                collectedThb = total,
                targetThb = target,
                rawHex = hex,
                message = amount?.let { "Bill returned — $it THB" } ?: "Bill returned (0x11)",
            ),
        )
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
        private const val POLL_INTERVAL_MS = 300L
        private const val POLL_STATUS_TIMEOUT_MS = 500L

        private const val CMD_ACK = 0x02
        private const val CMD_STATUS_POLL = 0x0C
        private const val CMD_ACCEPT = 0x02
        private const val CMD_DECLINE = 0x0F
        private const val CMD_HOLD = 0x18
        private const val CMD_ENABLE = 0x3E
        private const val CMD_DISABLE = 0x5E
        private const val CMD_RESET = 0x30
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

        /** Lowest banknote the kiosk will stack (฿100+). ฿20 / ฿50 are declined. */
        private const val MIN_ACCEPTED_THB = 100

        // Slot codes 0x40–0x44 as programmed on the NK77 for THB.
        private val THB_DENOMINATIONS = intArrayOf(20, 50, 100, 500, 1000)
    }
}
