package pos.tablet

import android.content.Context
import android.content.Intent
import org.json.JSONObject

/**
 * 05b M-4 / N-17: `:alerts` → main messages: explicit broadcasts to [Ipc.ACTION_TO_MAIN] within the package
 * (`setPackage`), sent with FLAG_RECEIVER_FOREGROUND so the main process gets them without background delay.
 */
object IpcReply {
    fun send(ctx: Context, op: String, json: JSONObject?, reqId: String? = null) {
        val i = Intent(Ipc.ACTION_TO_MAIN)
            .setPackage(ctx.packageName)
            .addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
            .putExtra(Ipc.EXTRA_OP, op)
        if (reqId != null) i.putExtra(Ipc.EXTRA_REQ_ID, reqId)
        if (json != null) i.putExtra(Ipc.EXTRA_JSON, json.toString())
        try {
            ctx.applicationContext.sendBroadcast(i)
        } catch (e: Exception) {
            AlertLog.ev("ipc_send_failed", mapOf("op" to op, "error" to e.toString()))
        }
    }

    /** A reply to a request that carried [reqId] (nothing is sent when the request had none). */
    fun reply(ctx: Context, reqId: String?, json: JSONObject) {
        if (reqId == null) return
        send(ctx, Ipc.OP_REPLY, json, reqId)
    }

    /** §4.2 `state` body. A14 fills `update_ready`; `needs_context` comes from OP_SERVICE_STARTED (N-1). */
    fun state(ctx: Context, paired: Boolean, alertSocket: String, bindingRouteUntil: Long?) {
        val o = JSONObject()
            .put("paired", paired)
            .put("alert_socket", alertSocket)
            .put("binding_route_until", bindingRouteUntil ?: JSONObject.NULL)
            .put("update_ready", Updates.updateReady) // 05b A14: M-15 update downloaded and verified
            .put("needs_context", false)
        send(ctx, Ipc.OP_STATE, o)
    }

    fun serviceStarted(ctx: Context) = send(ctx, Ipc.OP_SERVICE_STARTED, JSONObject())
}
