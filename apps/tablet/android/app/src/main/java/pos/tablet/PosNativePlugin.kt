package pos.tablet

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Looper
import android.provider.Settings
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * 05b §4.2: the `PosNative` bridge, every method guarded per page (§3.6, O-14, N-8). The page never reads the
 * token (M-2); token, session and context go to `:alerts` by broadcast (M-4, N-17, §5). No method exits lock task.
 */
@CapacitorPlugin(
    name = "PosNative",
    permissions = [Permission(alias = PosNativePlugin.NOTIFICATIONS, strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class PosNativePlugin : Plugin() {
    private lateinit var ipc: IpcClient
    @Volatile private var lastState: JSONObject? = null

    override fun load() {
        ipc = IpcClient(context) { op, body -> onAlertsMessage(op, body) }
        ipc.start()
    }

    override fun handleOnDestroy() {
        if (::ipc.isInitialized) ipc.stop()
    }

    /** §4.2 `state` event; N-1 `service_started` → the last state + `needs_context: true`. */
    private fun onAlertsMessage(op: String, body: JSONObject) {
        when (op) {
            Ipc.OP_STATE -> {
                lastState = body
                notifyListeners("state", JSObject.fromJSONObject(body), true)
            }
            Ipc.OP_SERVICE_STARTED -> notifyListeners("state", JSObject.fromJSONObject(StateEvent.serviceStarted(lastState)), true)
            else -> Log.i(TAG, "ignored op $op")
        }
    }

    // ---- §3.6 guard -------------------------------------------------------------------------------------

    /** N-8: the WebView's main-frame URL, read on the UI thread; null (→ deny) when it does not answer in time. */
    private fun mainFrameUrl(): String? {
        val wv = bridge?.webView ?: return null
        if (Looper.myLooper() == Looper.getMainLooper()) return wv.url
        val ref = AtomicReference<String?>(null)
        val done = CountDownLatch(1)
        wv.post { try { ref.set(wv.url) } finally { done.countDown() } }
        return if (done.await(GUARD_TIMEOUT_MS, TimeUnit.MILLISECONDS)) ref.get() else null
    }

    /** True when [method] may run for the current page; otherwise rejects with NOT_ALLOWED_HERE and logs. */
    private fun allowed(call: PluginCall, method: String): Boolean {
        val url = mainFrameUrl()
        if (Guard.allowed(method, url, MainStore.hubOrigin(context))) return true
        Log.w(TAG, "refused $method from ${originForLog(url)}")
        call.reject(NOT_ALLOWED_HERE, NOT_ALLOWED_HERE)
        return false
    }

    /** Log the origin and path only (a `/pair` query or hash may carry a code). */
    private fun originForLog(url: String?): String = try {
        val u = java.net.URI(url ?: return "null")
        "${u.scheme}://${u.host}:${u.port}${u.rawPath.orEmpty()}"
    } catch (e: Exception) { "unparsable" }

    // ---- methods (§4.2) ---------------------------------------------------------------------------------

    @PluginMethod
    fun info(call: PluginCall) {
        if (!allowed(call, "info")) return
        call.resolve(JSObject.fromJSONObject(MainHealth.info(BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME, isDeviceOwner()).put("debug", BuildConfig.DEBUG)))
    }

    /**
     * Plan batch A-2, DEBUG BUILDS ONLY: pair natively with a token minted by tools/tablet-soak, until phase B's
     * hub pair page calls setDeviceToken (spec H-2). Release builds refuse it.
     */
    @PluginMethod
    fun debugPairing(call: PluginCall) {
        if (!BuildConfig.DEBUG) return call.reject("NOT_ALLOWED_HERE", "NOT_ALLOWED_HERE")
        if (!allowed(call, "debugPairing")) return
        val origin = HubOrigin.normalize(call.getString("origin")) ?: return call.reject(BAD_ORIGIN_MESSAGE)
        val token = call.getString("token")?.trim()
        if (token.isNullOrEmpty()) return call.reject("token required")
        ipc.send(
            Ipc.OP_SET_DEVICE_TOKEN,
            org.json.JSONObject().put("token", token).put("device_id", call.getString("device_id") ?: "debug")
                .put("device_type", "tablet").put("hub_origin", origin),
        )
        call.resolve()
    }

    @PluginMethod
    fun probeHub(call: PluginCall) {
        if (!allowed(call, "probeHub")) return
        val origin = HubOrigin.normalize(call.getString("origin"))
        if (origin == null) {
            call.resolve(JSObject().put("ok", false).put("reason", "bad_origin").put("message", BAD_ORIGIN_MESSAGE))
            return
        }
        // M-1 / N-3: never on the main thread (the plugin thread may be busy with other calls too).
        Thread({
            val r = try { HubProbe.probe(origin) } catch (e: Exception) { ProbeResult(false, "no_hub", null) }
            call.resolve(JSObject().put("ok", r.ok).put("reason", r.reason ?: JSONObject.NULL).put("message", r.message ?: JSONObject.NULL))
        }, "PosProbe").start()
    }

    @PluginMethod
    fun getHubOrigin(call: PluginCall) {
        if (!allowed(call, "getHubOrigin")) return
        call.resolve(JSObject().put("origin", MainStore.hubOrigin(context) ?: JSONObject.NULL))
    }

    @PluginMethod
    fun setHubOrigin(call: PluginCall) {
        if (!allowed(call, "setHubOrigin")) return
        val origin = HubOrigin.normalize(call.getString("origin")) ?: return call.reject(BAD_ORIGIN_MESSAGE)
        // M-16: a different hub address means this tablet must pair again (the bundled page confirmed it).
        val previous = MainStore.hubOrigin(context)
        if (previous != null && previous != origin) ipc.send(Ipc.OP_CLEAR_PAIRING)
        MainStore.setHubOrigin(context, origin)
        if (MainStore.hubOrigin(context) != origin) return call.reject("The hub address could not be saved")
        call.resolve(JSObject().put("origin", origin))
        // M-1: switching = recreate(); the new activity loads the hub page.
        activity?.let { a -> a.runOnUiThread { a.recreate() } }
    }

    @PluginMethod
    fun setDeviceToken(call: PluginCall) {
        if (!allowed(call, "setDeviceToken")) return
        val token = call.getString("token")
        val deviceId = call.getString("device_id")
        val deviceType = call.getString("device_type")
        when (val r = TokenRule.check(token, deviceId, deviceType)) {
            is TokenRule.Result.Invalid -> return call.reject(r.message)
            TokenRule.Result.NotTablet -> return call.reject(TokenRule.NOT_TABLET_MESSAGE, TokenRule.NOT_TABLET_CODE) // M-3
            TokenRule.Result.Ok -> Unit
        }
        val hub = MainStore.hubOrigin(context) ?: return call.reject(NOT_ALLOWED_HERE, NOT_ALLOWED_HERE)
        ipc.send(
            Ipc.OP_SET_DEVICE_TOKEN,
            JSONObject().put("token", token).put("device_id", deviceId).put("device_type", deviceType).put("hub_origin", hub),
        )
        call.resolve()
    }

    @PluginMethod
    fun confirmRevoked(call: PluginCall) {
        if (!allowed(call, "confirmRevoked")) return
        // §3.5 / N-5: native runs the HTTP check in :alerts; no answer → keep everything.
        ipc.request(Ipc.OP_CONFIRM_REVOKED, JSONObject(), CONFIRM_TIMEOUT_MS) { reply ->
            call.resolve(JSObject.fromJSONObject(reply ?: JSONObject().put("revoked", false).put("reason", "no_answer")))
        }
    }

    @PluginMethod
    fun setSession(call: PluginCall) {
        if (!allowed(call, "setSession")) return
        val signedIn = call.getBoolean("signed_in") ?: return call.reject("signed_in is required")
        val body = JSONObject().put("signed_in", signedIn)
        call.getString("staff_id")?.let { body.put("staff_id", it) }
        ipc.send(Ipc.OP_SET_SESSION, body)
        call.resolve()
    }

    @PluginMethod
    fun setDeviceContext(call: PluginCall) {
        if (!allowed(call, "setDeviceContext")) return
        val alwaysOn = call.getBoolean("always_on") ?: return call.reject("always_on is required")
        val language = call.getString("language") ?: return call.reject("language is required")
        val lockTask = call.getBoolean("lock_task") ?: return call.reject("lock_task is required")
        MainStore.setLockTask(context, lockTask) // M-17 / N-4: the activity applies it at the next resume
        activity?.runOnUiThread { (activity as? MainActivity)?.applyLockTask() } // 05b A15: re-evaluate now (M-17)
        ipc.send(Ipc.OP_SET_DEVICE_CONTEXT, JSONObject().put("always_on", alwaysOn).put("language", language).put("lock_task", lockTask))
        call.resolve()
    }

    @PluginMethod
    fun reportShown(call: PluginCall) {
        if (!allowed(call, "reportShown")) return
        val alertId = call.getString("alert_id")?.takeIf { it.isNotBlank() } ?: return call.reject("alert_id is required")
        val step = call.getInt("step") ?: return call.reject("step is required")
        ipc.send(Ipc.OP_REPORT_SHOWN, JSONObject().put("alert_id", alertId).put("step", step))
        call.resolve()
    }

    @PluginMethod
    fun setWakeLock(call: PluginCall) {
        if (!allowed(call, "setWakeLock")) return
        val on = call.getBoolean("on") ?: return call.reject("on is required")
        ipc.send(Ipc.OP_SET_WAKE_LOCK, JSONObject().put("on", on))
        call.resolve()
    }

    @PluginMethod
    fun checkForUpdate(call: PluginCall) {
        if (!allowed(call, "checkForUpdate")) return
        ipc.request(Ipc.OP_CHECK_FOR_UPDATE, JSONObject(), UPDATE_TIMEOUT_MS) { reply ->
            if (reply == null) call.reject("The alert service did not answer") else call.resolve(JSObject.fromJSONObject(reply))
        }
    }

    @PluginMethod
    fun health(call: PluginCall) {
        if (!allowed(call, "health")) return
        val main = MainHealth.toJson(MainHealth.collect(context))
        ipc.request(Ipc.OP_HEALTH, JSONObject(), HEALTH_TIMEOUT_MS) { reply ->
            call.resolve(JSObject.fromJSONObject(MainHealth.merge(main, reply, lastState)))
        }
    }

    @PluginMethod
    fun openSetting(call: PluginCall) {
        if (!allowed(call, "openSetting")) return
        val pkgUri = Uri.parse("package:${context.packageName}")
        when (call.getString("which")) {
            "notifications" -> {
                if (Build.VERSION.SDK_INT >= 33) {
                    val st = getPermissionState(NOTIFICATIONS)
                    if (st == PermissionState.PROMPT || st == PermissionState.PROMPT_WITH_RATIONALE) {
                        requestPermissionForAlias(NOTIFICATIONS, call, "notificationsPermissionCallback")
                        return
                    }
                }
                openNotificationSettings(call)
            }
            "battery" -> open(call, batteryIntent(pkgUri))
            "fsi" -> if (Build.VERSION.SDK_INT >= 34) open(call, Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkgUri)) else call.resolve()
            "install" -> open(call, Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, pkgUri))
            "app" -> open(call, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri))
            else -> call.reject("which must be notifications, battery, fsi, install or app")
        }
    }

    @PermissionCallback
    private fun notificationsPermissionCallback(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED))
    }

    @SuppressLint("BatteryLife")
    private fun batteryIntent(pkgUri: Uri) = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkgUri)

    private fun openNotificationSettings(call: PluginCall) =
        open(call, Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))

    private fun open(call: PluginCall, intent: Intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            Log.w(TAG, "openSetting failed: $e")
            call.reject("This setting is not available on this tablet")
        }
    }

    // ---- inherited Capacitor methods ----------------------------------------------------------------------

    /** §3.6: `addListener('state')` from the hub origin or the bundled origin only. */
    @PluginMethod(returnType = PluginMethod.RETURN_NONE)
    override fun addListener(call: PluginCall) {
        if (!allowed(call, "addListener")) return
        super.addListener(call)
    }

    /** Not in §3.6: refused for every page (permissions go through `openSetting`). */
    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        if (!allowed(call, "checkPermissions")) return
        super.checkPermissions(call)
    }

    /** Not in §3.6: refused for every page (permissions go through `openSetting`). */
    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (!allowed(call, "requestPermissions")) return
        super.requestPermissions(call)
    }

    private fun isDeviceOwner(): Boolean =
        context.getSystemService(DevicePolicyManager::class.java)?.isDeviceOwnerApp(context.packageName) ?: false

    companion object {
        const val NOTIFICATIONS = "notifications"
        const val NOT_ALLOWED_HERE = "NOT_ALLOWED_HERE"
        private const val TAG = "PosNative"
        private const val GUARD_TIMEOUT_MS = 500L
        private const val CONFIRM_TIMEOUT_MS = 3_000L
        private const val HEALTH_TIMEOUT_MS = 1_000L
        private const val UPDATE_TIMEOUT_MS = 3_000L
        private const val BAD_ORIGIN_MESSAGE = "Enter the hub address with its port, e.g. 192.168.1.10:8080"
    }
}
