package pos.tablet

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 05b M-6 (S6) / M-15: BOOT_COMPLETED → watchdog in Spec.BOOT_WATCHDOG_MS + start the service;
 * MY_PACKAGE_REPLACED (after the self-update) → watchdog + start. Only when `want_running`. Exported for the
 * system actions only (§7): any other action is ignored ([WatchdogPlan.onBroadcast]).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        AlertLog.init(ctx.filesDir)
        val want = AlertsStore.wantRunning(ctx)
        val plan = WatchdogPlan.onBroadcast(intent.action, want)
        AlertLog.ev("boot_received", mapOf("action" to intent.action, "want_running" to want, "arm_in_ms" to plan.armInMs))
        plan.armInMs?.let { Watchdog.schedule(ctx, it) }
        if (plan.startService) AlertService.start(ctx, plan.reason ?: "boot")
    }
}
