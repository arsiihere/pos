package pos.tablet

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * 05b M-18 (plan A16): the main-process half of `health()`. [collect] reads the platform (thin glue);
 * [toJson] and [merge] are pure, so the shape is unit-tested.
 */
object MainHealth {
    data class Channel(val importance: Int?, val sound: String?)

    data class Snapshot(
        val deviceOwner: Boolean,
        val lockTaskState: String,            // none | locked | pinned
        val postNotifications: Boolean,
        val channels: Map<String, Channel?>, // id → null when the channel does not exist
        val fsiAllowed: Boolean,
        val batteryExempt: Boolean,
        val exactAlarms: Boolean,
        val canInstall: Boolean,
        val mainStoreError: String?,
        val versionName: String,
    )

    val CHANNEL_IDS = listOf(Channels.STATUS, Channels.URGENT, Channels.ACTION, Channels.INFO, Channels.RESULT)

    /** The `:alerts` half's keys (lane 3's HEALTH reply); filled with defaults when it does not answer. */
    val ALERTS_KEYS = listOf("service_connected", "alert_socket", "last_frame_age_ms", "wake_lock", "store_readable", "replaced_by_other")

    fun lockTaskState(mode: Int): String = when (mode) {
        ActivityManagerModes.LOCKED -> "locked"
        ActivityManagerModes.PINNED -> "pinned"
        else -> "none"
    }

    /** ActivityManager.LOCK_TASK_MODE_* values (fixed platform constants; inlined so the pure code needs no stub). */
    object ActivityManagerModes { const val NONE = 0; const val LOCKED = 1; const val PINNED = 2 }

    /** M-14 `info()` body. */
    fun info(versionCode: Int, versionName: String, deviceOwner: Boolean): JSONObject = JSONObject().apply {
        put("native_api", Spec.NATIVE_API)
        put("version_code", versionCode)
        put("version_name", versionName)
        put("device_owner", deviceOwner)
    }

    fun toJson(s: Snapshot): JSONObject {
        val ch = JSONObject()
        for ((id, c) in s.channels) {
            ch.put(id, JSONObject().apply {
                put("exists", c != null)
                put("importance", c?.importance ?: JSONObject.NULL)
                put("sound", c?.sound ?: JSONObject.NULL)
            })
        }
        return JSONObject().apply {
            put("device_owner", s.deviceOwner)
            put("lock_task_state", s.lockTaskState)
            put("post_notifications", s.postNotifications)
            put("channels", ch)
            put("fsi_allowed", s.fsiAllowed)
            put("battery_exempt", s.batteryExempt)
            put("exact_alarms", s.exactAlarms)
            put("can_install", s.canInstall)
            put("main_store_error", s.mainStoreError ?: JSONObject.NULL)
            put("native_api", Spec.NATIVE_API)
            put("version_name", s.versionName)
        }
    }

    /**
     * The `health()` body: the `:alerts` reply (null = no answer in time → `service_connected: false`, its other
     * fields null), the main fields on top (they own their keys), and `paired` from the last `state` event.
     */
    fun merge(main: JSONObject, alerts: JSONObject?, lastState: JSONObject?): JSONObject {
        val out = JSONObject()
        if (alerts == null) {
            for (k in ALERTS_KEYS) out.put(k, JSONObject.NULL)
            out.put("service_connected", false)
        } else {
            for (k in ALERTS_KEYS) out.put(k, alerts.opt(k) ?: JSONObject.NULL)
            for (k in alerts.keys()) out.put(k, alerts.get(k))
            if (!alerts.has("service_connected")) out.put("service_connected", true)
        }
        for (k in main.keys()) out.put(k, main.get(k))
        out.put("paired", lastState?.opt("paired") ?: JSONObject.NULL)
        return out
    }

    fun collect(ctx: Context): Snapshot {
        val pkg = ctx.packageName
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val dpm = ctx.getSystemService(DevicePolicyManager::class.java)
        val am = ctx.getSystemService(ActivityManager::class.java)
        val pm = ctx.getSystemService(PowerManager::class.java)
        val alarms = ctx.getSystemService(AlarmManager::class.java)
        val channels = CHANNEL_IDS.associateWith { id ->
            if (Build.VERSION.SDK_INT >= 26) nm?.getNotificationChannel(id)?.let { Channel(it.importance, it.sound?.toString()) } else null
        }
        val postNotifications = (nm?.areNotificationsEnabled() ?: false) && (
            Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            )
        return Snapshot(
            deviceOwner = dpm?.isDeviceOwnerApp(pkg) ?: false,
            lockTaskState = lockTaskState(am?.lockTaskModeState ?: ActivityManagerModes.NONE),
            postNotifications = postNotifications,
            channels = channels,
            fsiAllowed = if (Build.VERSION.SDK_INT >= 34) nm?.canUseFullScreenIntent() ?: false else true,
            batteryExempt = pm?.isIgnoringBatteryOptimizations(pkg) ?: false,
            exactAlarms = if (Build.VERSION.SDK_INT >= 31) alarms?.canScheduleExactAlarms() ?: false else true,
            canInstall = if (Build.VERSION.SDK_INT >= 26) ctx.packageManager.canRequestPackageInstalls() else true,
            mainStoreError = MainStore.storeError,
            versionName = BuildConfig.VERSION_NAME,
        )
    }
}
