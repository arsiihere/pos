package pos.tablet

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock

/**
 * 05b M-6 pure decisions (test: WatchdogTest). The Android glue below only carries them out.
 */
object WatchdogPlan {
    enum class Mode { EXACT, INEXACT }

    /** `setExactAndAllowWhileIdle` when exact alarms are allowed (always below 31), else the non-exact fallback. */
    fun mode(sdk: Int, canScheduleExact: Boolean): Mode =
        if (sdk < 31 || canScheduleExact) Mode.EXACT else Mode.INEXACT

    enum class Tick {
        /** want_running false (never paired, revoked, unpaired): do nothing and do not reschedule. */
        STOP,
        /** The service was killed: start it again (full start: locks, network callback, socket). */
        RESTART,
        /** The service is alive: `onStartCommand(watchdog_check)` re-takes lost locks and reconnects if down. */
        CHECK,
    }

    fun onTick(wantRunning: Boolean, serviceRunning: Boolean): Tick = when {
        !wantRunning -> Tick.STOP
        serviceRunning -> Tick.CHECK
        else -> Tick.RESTART
    }

    /** What a system broadcast does: arm the watchdog in [armInMs] (null = not at all) and start the service. */
    data class Boot(val armInMs: Long?, val startService: Boolean, val reason: String?)

    const val ACTION_BOOT = "android.intent.action.BOOT_COMPLETED"
    const val ACTION_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED"

    /** BOOT_COMPLETED → arm in 60 s + start; MY_PACKAGE_REPLACED (M-15 self-update) → arm + start; only if want_running. */
    fun onBroadcast(action: String?, wantRunning: Boolean): Boot = when {
        !wantRunning -> Boot(null, false, null)
        action == ACTION_BOOT -> Boot(Spec.BOOT_WATCHDOG_MS, true, "boot")
        action == ACTION_REPLACED -> Boot(Spec.WATCHDOG_MS, true, "package_replaced")
        else -> Boot(null, false, null) // exported receiver: anything but the two system actions is ignored (§7)
    }
}

/**
 * 05b M-6: an `ELAPSED_REALTIME_WAKEUP` allow-while-idle alarm every Spec.WATCHDOG_MS (Doze lets one fire
 * roughly every 9+ min). Exact (`USE_EXACT_ALARM` 33+, `SCHEDULE_EXACT_ALARM` 31–32) so the service start
 * from the alarm is exempt from the Android 12+ background-start ban; non-exact only if exact is refused.
 */
object Watchdog {
    private const val ACTION = "pos.tablet.WATCHDOG"
    private const val REQUEST_CODE = 42

    private fun pi(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, REQUEST_CODE, Intent(ctx, WatchdogReceiver::class.java).setAction(ACTION),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    /** (Re)arms the one watchdog alarm [delayMs] from now (replaces a pending one). */
    fun schedule(ctx: Context, delayMs: Long = Spec.WATCHDOG_MS) {
        try {
            val am = ctx.getSystemService(AlarmManager::class.java) ?: return
            val at = SystemClock.elapsedRealtime() + delayMs
            val canExact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
            val mode = WatchdogPlan.mode(Build.VERSION.SDK_INT, canExact)
            try {
                if (mode == WatchdogPlan.Mode.EXACT) {
                    am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi(ctx))
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi(ctx))
                }
                AlertLog.ev("watchdog_armed", mapOf("delay_ms" to delayMs, "mode" to mode.name))
            } catch (e: SecurityException) {
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi(ctx))
                AlertLog.ev("watchdog_armed", mapOf("delay_ms" to delayMs, "mode" to "INEXACT", "exact_refused" to e.toString()))
            }
        } catch (e: Exception) {
            AlertLog.ev("watchdog_arm_failed", mapOf("error" to e.toString()))
        }
    }

    fun cancel(ctx: Context) {
        try { ctx.getSystemService(AlarmManager::class.java)?.cancel(pi(ctx)) } catch (_: Exception) {}
    }
}

/** 05b M-6: the alarm's receiver (process `:alerts`, not exported). */
class WatchdogReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        AlertLog.init(ctx.filesDir)
        val want = AlertsStore.wantRunning(ctx)
        val running = AlertService.instance != null
        val tick = WatchdogPlan.onTick(want, running)
        AlertLog.ev("watchdog", mapOf("want_running" to want, "service_running" to running, "action" to tick.name))
        when (tick) {
            WatchdogPlan.Tick.STOP -> return
            WatchdogPlan.Tick.CHECK -> AlertService.start(ctx, AlertService.REASON_WATCHDOG)
            WatchdogPlan.Tick.RESTART -> AlertService.start(ctx, "watchdog_restart")
        }
        Watchdog.schedule(ctx)
        // M-15: the hourly update check and the install window ride on the watchdog tick.
        Updates.client(ctx).tickAsync()
    }
}
