package pos.tablet

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * 05b M-4 / §4.2: the `:alerts` end of the Contract ops (main → [Ipc.ACTION_TO_ALERTS], unexported).
 * Replies go back with [IpcReply] (ACTION_TO_MAIN, echoing `req_id`). Ops with I/O use goAsync().
 */
class AlertsReceiver : BroadcastReceiver() {
    companion object {
        private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "pos-alerts-rx").apply { isDaemon = true } }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Ipc.ACTION_TO_ALERTS) return
        val ctx = context.applicationContext
        AlertLog.init(ctx.filesDir)
        val op = intent.getStringExtra(Ipc.EXTRA_OP) ?: return
        val reqId = intent.getStringExtra(Ipc.EXTRA_REQ_ID)
        val body = try { JSONObject(intent.getStringExtra(Ipc.EXTRA_JSON) ?: "{}") } catch (_: Exception) { JSONObject() }
        AlertLog.ev("ipc_op", mapOf("op" to op))
        when (op) {
            Ipc.OP_SET_DEVICE_TOKEN -> async { setDeviceToken(ctx, body, reqId) }
            Ipc.OP_CONFIRM_REVOKED -> async { confirmRevoked(ctx, reqId) }
            Ipc.OP_SET_SESSION -> {
                AlertsMemory.signedIn = body.optBoolean("signed_in", false)
                AlertsMemory.staffId = body.optString("staff_id", "").takeIf { it.isNotEmpty() }
                // 05b A14: signing out may open the install window (D-3).
                if (AlertsMemory.signedIn == false) Updates.client(ctx).windowMayHaveOpened()
                AlertService.instance?.onPageStateChanged() // 05b A10 / A11: hold flush, repeat take-over / hand-back
                IpcReply.reply(ctx, reqId, JSONObject().put("ok", true))
            }
            Ipc.OP_SET_DEVICE_CONTEXT -> async {
                // M-21 / N-1: always_on and language persisted here; lock_task belongs to main_plain (main process).
                val lang = body.optString("language", "en").takeIf { it == "en" || it == "ur" } ?: "en"
                AlertsStore.setDeviceContext(ctx, body.optBoolean("always_on", false), lang)
                IpcReply.reply(ctx, reqId, JSONObject().put("ok", true))
            }
            Ipc.OP_REPORT_SHOWN -> {
                val id = body.optString("alert_id", "")
                val step = body.opt("step")
                if (id.isNotEmpty() && step is Number) {
                    AlertsMemory.addReported(id, step.toInt())
                    AlertService.instance?.onReportShown(id, step.toInt()) // 05b A11 (M-8): drop a held post
                }
                IpcReply.reply(ctx, reqId, JSONObject().put("ok", true))
            }
            Ipc.OP_ACTIVITY_VISIBLE -> {
                AlertsMemory.activityVisible = body.optBoolean("visible", false) // O-18 hand-over: A10
                AlertService.instance?.onPageStateChanged() // 05b A10 (O-18): take over / hand back
                IpcReply.reply(ctx, reqId, JSONObject().put("ok", true))
            }
            Ipc.OP_HEALTH -> async { IpcReply.reply(ctx, reqId, health(ctx)) }
            Ipc.OP_SET_WAKE_LOCK -> async {
                AlertsStore.setWakeLock(ctx, body.optBoolean("on", true))
                AlertService.instance?.applyLocksAsync()
                IpcReply.reply(ctx, reqId, JSONObject().put("ok", true))
            }
            Ipc.OP_CLEAR_PAIRING -> async { AlertService.revoked(ctx, "hub_address_changed") }
            // 05b A14: checkForUpdate() runs a check now and answers { state } (M-15, §4.2).
            Ipc.OP_CHECK_FOR_UPDATE -> {
                val pending = goAsync()
                try {
                    Updates.client(ctx).checkNow("check_for_update") { s ->
                        try { IpcReply.reply(ctx, reqId, JSONObject().put("state", s.wire)) } finally { pending.finish() }
                    }
                } catch (e: Exception) {
                    pending.finish()
                }
            }
            else -> AlertLog.ev("ipc_unknown_op", mapOf("op" to op))
        }
    }

    private fun async(work: () -> Unit) {
        val pending = goAsync()
        try {
            io.execute {
                try { work() } catch (e: Exception) {
                    AlertLog.ev("ipc_op_failed", mapOf("error" to e.toString()))
                } finally {
                    pending.finish()
                }
            }
        } catch (e: Exception) {
            pending.finish()
        }
    }

    /** M-3: `{ token, device_id, device_type, hub_origin }`; refuses a non-`tablet` approval. */
    private fun setDeviceToken(ctx: Context, b: JSONObject, reqId: String?) {
        val token = b.optString("token", "")
        val deviceId = b.optString("device_id", "")
        val type = b.optString("device_type", "")
        val origin = b.optString("hub_origin", "").trim().trimEnd('/')
        val err = when {
            type != "tablet" -> "NOT_TABLET"
            token.isEmpty() || deviceId.isEmpty() -> "BAD_TOKEN"
            !(origin.startsWith("http://") || origin.startsWith("https://")) -> "BAD_ORIGIN"
            else -> null
        }
        if (err != null) {
            AlertLog.ev("set_device_token_refused", mapOf("why" to err))
            IpcReply.reply(ctx, reqId, JSONObject().put("ok", false).put("error", err))
            return
        }
        if (!AlertsStore.setCredentials(ctx, token, deviceId, origin)) {
            IpcReply.reply(ctx, reqId, JSONObject().put("ok", false).put("error", "STORE_UNWRITABLE"))
            return
        }
        AlertsStore.setWantRunning(ctx, true)
        AlertService.start(ctx, "set_device_token")
        IpcReply.reply(ctx, reqId, JSONObject().put("ok", true))
    }

    /** §3.5 / N-5: the page's unpair triggers come here; only a confirmed revoke clears anything. */
    private fun confirmRevoked(ctx: Context, reqId: String?) {
        val origin = AlertsStore.hubOrigin(ctx)
        val token = AlertsStore.token(ctx)
        if (origin.isNullOrEmpty() || token.isNullOrEmpty()) {
            // Native holds no token (never paired here, or M-22 store loss): nothing to check; the page keeps
            // its keys and offers them through setDeviceToken (N-9).
            IpcReply.reply(ctx, reqId, JSONObject().put("revoked", false).put("reason", "NO_NATIVE_TOKEN"))
            return
        }
        val result = TokenCheck(BuildConfig.VERSION_NAME).check(origin, token)
        AlertLog.ev("confirm_revoked", mapOf("result" to result.javaClass.simpleName, "reason" to result.reason))
        val out = JSONObject().put("revoked", result is CloseCodes.Check.Revoked)
        result.reason?.let { out.put("reason", it) }
        if (result is CloseCodes.Check.Revoked) AlertService.revoked(ctx, result.reason ?: "DEVICE_REVOKED")
        IpcReply.reply(ctx, reqId, out)
    }

    /** The `:alerts` half of M-18. */
    private fun health(ctx: Context): JSONObject {
        val s = AlertService.instance
        val readable = AlertsStore.storeReadable(ctx)
        val o = JSONObject()
            .put("service_connected", s != null)
            .put("alert_socket", s?.alertSocket ?: "down")
            .put("last_frame_age_ms", s?.lastFrameAt?.takeIf { it > 0 }?.let { System.currentTimeMillis() - it } ?: JSONObject.NULL)
            .put("wake_lock", AlertsStore.wakeLock(ctx))
            .put("wake_lock_held", s?.wakeLockHeld ?: false)
            .put("store_readable", readable)
            .put("replaced_by_other", s?.replacedByOther ?: false)
            .put("paired", AlertsStore.paired(ctx))
        if (!readable) o.put("store_error", AlertsStore.storeError(ctx) ?: "")
        return o
    }
}
