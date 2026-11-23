package pos.spike.lockalerts

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * [spike lock-alerts] Debug-only adb control (throwaway; a release build would never export this):
 *   adb shell am broadcast -a pos.spike.SET_TOKEN -n pos.spike.lockalerts/.DebugReceiver --es url http://HUB:3000 --es token TOK
 *   adb shell am broadcast -a pos.spike.START     -n pos.spike.lockalerts/.DebugReceiver
 *   adb shell am broadcast -a pos.spike.STOP      -n pos.spike.lockalerts/.DebugReceiver
 *   adb shell am broadcast -a pos.spike.SET_TOGGLE -n pos.spike.lockalerts/.DebugReceiver --es key wake_lock --es value true
 *   adb shell am broadcast -a pos.spike.CLEAR_LOG -n pos.spike.lockalerts/.DebugReceiver
 */
class DebugReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        SpikeLog.init(context)
        when (intent.action) {
            "pos.spike.SET_TOKEN" -> {
                val url = intent.getStringExtra("url")
                val token = intent.getStringExtra("token")
                if (url.isNullOrBlank() || token.isNullOrBlank()) {
                    SpikeLog.ev("debug_set_token_rejected"); return
                }
                SpikeStore.setCredentials(context, url, token)
                SpikeLog.ev("debug_set_token", mapOf("url" to url))
            }
            "pos.spike.START" -> {
                SpikeStore.setWantRunning(context, true)
                try {
                    AlertService.start(context, "debug_broadcast")
                } catch (e: Exception) {
                    // Android 12+: a background FGS start can be refused unless the app is battery-exempt.
                    SpikeLog.ev("debug_start_failed", mapOf("error" to e.toString()))
                }
            }
            "pos.spike.STOP" -> {
                SpikeStore.setWantRunning(context, false)
                Watchdog.cancel(context)
                AlertService.stop(context)
            }
            "pos.spike.SET_TOGGLE" -> {
                val key = intent.getStringExtra("key") ?: return
                val value = intent.getStringExtra("value") ?: return
                SpikeStore.setToggle(context, key, value)
                SpikeLog.ev("toggle_set", mapOf("key" to key, "value" to value, "via" to "adb"))
            }
            "pos.spike.CLEAR_LOG" -> SpikeLog.clear(context)
        }
    }
}
