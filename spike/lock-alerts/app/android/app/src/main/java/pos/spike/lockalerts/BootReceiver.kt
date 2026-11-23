package pos.spike.lockalerts

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** [spike lock-alerts] S6: start the service after boot / app update when it was running. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        SpikeLog.init(context)
        val want = SpikeStore.wantRunning(context)
        SpikeLog.ev("boot_received", mapOf("action" to intent.action, "want_running" to want))
        if (!want) return
        Watchdog.schedule(context, 60_000)
        try {
            AlertService.start(context, "boot:${intent.action}")
        } catch (e: Exception) {
            SpikeLog.ev("boot_start_failed", mapOf("error" to e.toString()))
        }
    }
}
