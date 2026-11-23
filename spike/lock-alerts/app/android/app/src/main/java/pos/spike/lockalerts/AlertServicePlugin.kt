package pos.spike.lockalerts

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission

/**
 * [spike lock-alerts] JS bridge. configure() is the web → native token handoff 05b needs
 * (05a: the web layer gets the token from the pair-request flow and hands it to native storage).
 */
@CapacitorPlugin(
    name = "AlertService",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class AlertServicePlugin : Plugin() {

    override fun load() {
        SpikeLog.init(context)
    }

    @PluginMethod
    fun configure(call: PluginCall) {
        val url = call.getString("hubUrl")
        val token = call.getString("deviceToken")
        if (url.isNullOrBlank() || token.isNullOrBlank()) { call.reject("hubUrl and deviceToken are required"); return }
        SpikeStore.setCredentials(context, url, token)
        SpikeLog.ev("configured", mapOf("url" to url, "via" to "web"))
        call.resolve()
    }

    @PluginMethod
    fun start(call: PluginCall) {
        SpikeStore.setWantRunning(context, true)
        try {
            AlertService.start(context, "user")
            call.resolve()
        } catch (e: Exception) {
            SpikeLog.ev("user_start_failed", mapOf("error" to e.toString()))
            call.reject(e.toString())
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        SpikeStore.setWantRunning(context, false)
        Watchdog.cancel(context)
        AlertService.stop(context)
        call.resolve()
    }

    @PluginMethod
    fun setToggle(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key")
        val value = call.getString("value") ?: return call.reject("value")
        try {
            SpikeStore.setToggle(context, key, value)
            SpikeLog.ev("toggle_set", mapOf("key" to key, "value" to value, "via" to "web"))
            call.resolve()
        } catch (e: Exception) { call.reject(e.toString()) }
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val pm = context.getSystemService(PowerManager::class.java)
        val nm = context.getSystemService(NotificationManager::class.java)
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val r = JSObject()
        r.put("running", AlertService.running)
        r.put("socket", AlertService.socketState)
        r.put("lastFrameAt", AlertService.lastFrameAt)
        r.put("alertsReceived", AlertService.alertsReceived)
        r.put("reconnects", AlertService.reconnects)
        r.put("lastClose", AlertService.lastClose)
        r.put("hubUrl", SpikeStore.hubUrl(context))
        r.put("hasToken", SpikeStore.token(context) != null)
        r.put("toggles", JSObject.fromJSONObject(SpikeStore.toggles(context)))
        r.put("ignoringBatteryOptimizations", pm.isIgnoringBatteryOptimizations(context.packageName))
        r.put("notificationsEnabled", nm.areNotificationsEnabled())
        r.put("canUseFullScreenIntent", if (Build.VERSION.SDK_INT >= 34) nm.canUseFullScreenIntent() else true)
        r.put("deviceOwner", dpm.isDeviceOwnerApp(context.packageName))
        r.put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
        r.put("android", "${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        r.put("patch", Build.VERSION.SECURITY_PATCH)
        r.put("seenKeys", SpikeStore.seenCount(context))
        r.put("logPath", SpikeLog.path(context))
        call.resolve(r)
    }

    @PluginMethod
    fun logTail(call: PluginCall) {
        val n = call.getInt("lines") ?: 30
        val r = JSObject()
        r.put("lines", JSArray(SpikeLog.tail(context, n)))
        call.resolve(r)
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33) { call.resolve(); return }
        requestPermissionForAlias("notifications", call, "permCallback")
    }

    @com.getcapacitor.annotation.PermissionCallback
    private fun permCallback(call: PluginCall) { call.resolve() }

    @SuppressLint("BatteryLife")
    @PluginMethod
    fun requestBatteryExemption(call: PluginCall) {
        SpikeLog.ev("battery_exemption_requested")
        val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
        call.resolve()
    }

    @PluginMethod
    fun requestFullScreenIntent(call: PluginCall) {
        SpikeLog.ev("fsi_permission_requested")
        if (Build.VERSION.SDK_INT >= 34) {
            val i = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
        }
        call.resolve()
    }

    /**
     * Upload the JSONL log to the laptop receiver (scripts/log-receiver.mjs) — no adb needed.
     * X-Device-Now lets the receiver (on the hub's machine) estimate the clock skew.
     */
    @PluginMethod
    fun uploadLog(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) { call.reject("url is required"); return }
        Thread {
            try {
                val file = java.io.File(SpikeLog.path(context))
                val bytes = if (file.exists()) file.readBytes() else ByteArray(0)
                val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = 5000
                conn.readTimeout = 30000
                conn.setRequestProperty("Content-Type", "application/x-ndjson")
                conn.setRequestProperty("X-Device-Now", System.currentTimeMillis().toString())
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
                val code = conn.responseCode
                val body = (if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText() ?: ""
                conn.disconnect()
                SpikeLog.ev("log_uploaded", mapOf("url" to url, "bytes" to bytes.size, "status" to code))
                val r = JSObject()
                r.put("status", code)
                r.put("bytes", bytes.size)
                r.put("body", body)
                call.resolve(r)
            } catch (e: Exception) {
                SpikeLog.ev("log_upload_failed", mapOf("url" to url, "error" to e.toString()))
                call.reject(e.toString())
            }
        }.start()
    }

    @PluginMethod
    fun clearLog(call: PluginCall) {
        SpikeLog.clear(context)
        call.resolve()
    }
}
