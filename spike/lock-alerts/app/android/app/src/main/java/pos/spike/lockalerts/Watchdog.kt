package pos.spike.lockalerts

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock

/**
 * [spike lock-alerts] Watchdog: an alarm that fires even in Doze (allow-while-idle), wakes the CPU,
 * restarts AlertService if Android or the OEM killed it, and nudges a reconnect. Reschedules itself.
 * Doze lets an allow-while-idle alarm fire roughly every 9+ minutes, so the interval is 10 minutes.
 */
object Watchdog {
    const val INTERVAL_MS = 10 * 60 * 1000L
    private const val ACTION = "pos.spike.WATCHDOG"

    private fun pi(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, 42, Intent(ctx, WatchdogReceiver::class.java).setAction(ACTION),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun schedule(ctx: Context, delayMs: Long = INTERVAL_MS) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val at = SystemClock.elapsedRealtime() + delayMs
        val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi(ctx))
            else am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi(ctx))
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi(ctx))
        }
    }

    fun cancel(ctx: Context) {
        ctx.getSystemService(AlarmManager::class.java).cancel(pi(ctx))
    }
}

class WatchdogReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        SpikeLog.init(context)
        val want = SpikeStore.wantRunning(context)
        SpikeLog.ev("watchdog", mapOf("want_running" to want, "service_running" to AlertService.running, "socket" to AlertService.socketState))
        if (!want) return
        try {
            // Starts the service if it was killed; if it is alive, onStartCommand runs a health check.
            AlertService.start(context, if (AlertService.running) "watchdog_check" else "watchdog_restart")
        } catch (e: Exception) {
            SpikeLog.ev("watchdog_start_failed", mapOf("error" to e.toString()))
        }
        Watchdog.schedule(context)
    }
}
