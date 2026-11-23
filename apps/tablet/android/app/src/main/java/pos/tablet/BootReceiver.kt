package pos.tablet

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 05b M-6 skeleton (batch A-3): BOOT_COMPLETED / MY_PACKAGE_REPLACED → watchdog + service. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {}
}
