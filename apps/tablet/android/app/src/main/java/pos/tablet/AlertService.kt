package pos.tablet

import android.app.Service
import android.content.Intent
import android.os.IBinder

/** 05b M-4 skeleton (lane 3 replaces): foreground service in process :alerts holding the 01d alert-mode socket. */
class AlertService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
}
