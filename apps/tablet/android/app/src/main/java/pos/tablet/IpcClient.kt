package pos.tablet

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.UUID

/**
 * Pure: requests waiting for an `OP_REPLY` with their req_id. Each callback runs exactly once: with the reply,
 * or with null when its timeout fires first. [schedule] runs a Runnable after a delay (a Handler in the app,
 * a fake clock in tests).
 */
class PendingReplies(private val schedule: (delayMs: Long, task: Runnable) -> Unit) {
    private val waiting = HashMap<String, (JSONObject?) -> Unit>()

    fun add(reqId: String, timeoutMs: Long, callback: (JSONObject?) -> Unit) {
        synchronized(waiting) { waiting[reqId] = callback }
        schedule(timeoutMs, Runnable { take(reqId)?.invoke(null) })
    }

    /** Delivers a reply; false when the req_id is unknown (late after a timeout, or not ours). */
    fun complete(reqId: String?, body: JSONObject): Boolean {
        val cb = reqId?.let { take(it) } ?: return false
        cb(body)
        return true
    }

    /** Fails every waiting request at once (plugin destroyed). */
    fun failAll() {
        val all = synchronized(waiting) { waiting.values.toList().also { waiting.clear() } }
        all.forEach { it(null) }
    }

    fun size(): Int = synchronized(waiting) { waiting.size }

    private fun take(reqId: String) = synchronized(waiting) { waiting.remove(reqId) }
}

/** 05b §4.2 `state` event bodies (pure). */
object StateEvent {
    /** N-1: `:alerts` (re)started → the last state plus `needs_context: true`, so the page re-sends its context. */
    fun serviceStarted(last: JSONObject?): JSONObject {
        val out = if (last == null) JSONObject() else JSONObject(last.toString())
        out.put("needs_context", true)
        return out
    }
}

/**
 * 05b M-4 / N-17: the main process's side of the explicit in-package broadcasts to and from `:alerts`.
 * Sends [Ipc.ACTION_TO_ALERTS] with FLAG_RECEIVER_FOREGROUND and setPackage; one dynamic receiver for
 * [Ipc.ACTION_TO_MAIN] (RECEIVER_NOT_EXPORTED). Replies are matched by req_id; other ops go to [onMessage].
 */
class IpcClient(
    context: Context,
    private val onMessage: (op: String, body: JSONObject) -> Unit,
) {
    private val ctx = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private val pending = PendingReplies { delay, task -> handler.postDelayed(task, delay) }
    @Volatile private var registered = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            val op = intent.getStringExtra(Ipc.EXTRA_OP) ?: return
            val body = parse(intent.getStringExtra(Ipc.EXTRA_JSON))
            if (op == Ipc.OP_REPLY) {
                if (!pending.complete(intent.getStringExtra(Ipc.EXTRA_REQ_ID), body)) Log.i(TAG, "late or unknown reply")
            } else {
                onMessage(op, body)
            }
        }
    }

    fun start() {
        if (registered) return
        ContextCompat.registerReceiver(ctx, receiver, IntentFilter(Ipc.ACTION_TO_MAIN), ContextCompat.RECEIVER_NOT_EXPORTED)
        registered = true
    }

    fun stop() {
        if (!registered) return
        registered = false
        try { ctx.unregisterReceiver(receiver) } catch (e: IllegalArgumentException) { /* already gone */ }
        pending.failAll()
    }

    /** Fire-and-forget request to `:alerts`. */
    fun send(op: String, body: JSONObject = JSONObject()) = broadcast(op, body, null)

    /** Request with a reply; [callback] gets the reply body, or null after [timeoutMs]. */
    fun request(op: String, body: JSONObject, timeoutMs: Long, callback: (JSONObject?) -> Unit) {
        val reqId = UUID.randomUUID().toString()
        pending.add(reqId, timeoutMs, callback)
        broadcast(op, body, reqId)
    }

    private fun broadcast(op: String, body: JSONObject, reqId: String?) {
        val i = Intent(Ipc.ACTION_TO_ALERTS)
            .setPackage(ctx.packageName)
            .addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
            .putExtra(Ipc.EXTRA_OP, op)
            .putExtra(Ipc.EXTRA_JSON, body.toString())
        if (reqId != null) i.putExtra(Ipc.EXTRA_REQ_ID, reqId)
        ctx.sendBroadcast(i)
    }

    companion object {
        private const val TAG = "PosIpc"

        fun parse(s: String?): JSONObject = try { if (s.isNullOrEmpty()) JSONObject() else JSONObject(s) } catch (e: Exception) { JSONObject() }
    }
}
