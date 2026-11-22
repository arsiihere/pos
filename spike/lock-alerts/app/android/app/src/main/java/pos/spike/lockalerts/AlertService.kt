package pos.spike.lockalerts

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * [spike lock-alerts] Foreground service holding the 01d alert-mode socket (01d §3.7, §8.2).
 * auth { device_token } with NO session_token; handles alerts_open + alert; one notification per
 * (alert_id, step) (persisted dedupe); receipt { kind: 'delivered', step } after notify; backoff
 * 0.5 → 1 → 2 → 4 → 5 s cap (01d §8.1); 4401/4403 stop + clear token, 4426 stop, 4409 log + stop.
 * All state lives on one HandlerThread ("worker"); OkHttp callbacks post onto it.
 */
class AlertService : Service() {

    companion object {
        const val CH_STATUS = "spike_status"
        const val CH_ALERT = "spike_alert_v1"
        const val NOTIF_STATUS = 1
        private val BACKOFF_MS = longArrayOf(500, 1000, 2000, 4000, 5000)
        private const val HEARTBEAT_MS = 5 * 60 * 1000L
        // A stopping hub can accept TCP and never answer the upgrade (found in the script dry run):
        // no first frame within this window → cancel and reconnect.
        private const val FIRST_FRAME_TIMEOUT_MS = 10_000L

        // Status read by the plugin / page (best effort, no locking needed for a spike).
        @Volatile var socketState: String = "stopped"
        @Volatile var lastFrameAt: Long = 0
        @Volatile var alertsReceived: Int = 0
        @Volatile var reconnects: Int = 0
        @Volatile var lastClose: String = ""
        @Volatile var running: Boolean = false

        fun start(ctx: Context, reason: String) {
            val i = Intent(ctx, AlertService::class.java).putExtra("reason", reason)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, AlertService::class.java))
        }
    }

    private lateinit var thread: HandlerThread
    private lateinit var worker: Handler
    private var client: OkHttpClient? = null
    private var ws: WebSocket? = null
    private var wsGen = 0 // ignores callbacks of an old socket
    private var authedFirstFrame = false
    private var attempt = 0
    private var stopped = false
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private var notifId = 100

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        SpikeLog.init(this)
        createChannels()
        thread = HandlerThread("spike-worker").also { it.start() }
        worker = Handler(thread.looper)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val reason = intent?.getStringExtra("reason") ?: if (intent == null) "sticky_restart" else "unknown"
        goForeground("Starting…")
        SpikeLog.ev("service_start", mapOf("reason" to reason, "sdk" to Build.VERSION.SDK_INT))
        running = true
        worker.post {
            stopped = false
            applyLocks()
            registerNetworkCallback()
            if (ws == null) connect()
            scheduleHeartbeat()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        SpikeLog.ev("service_destroyed")
        running = false
        socketState = "stopped"
        worker.post {
            stopped = true
            ws?.close(1000, "service stopped")
            ws = null
            releaseLocks()
            unregisterNetworkCallback()
            client?.dispatcher?.executorService?.shutdown()
            thread.quitSafely()
        }
        super.onDestroy()
    }

    // ------------------------------------------------------------------ connection

    private fun connect() {
        if (stopped) return
        val hub = SpikeStore.hubUrl(this)
        val token = SpikeStore.token(this)
        if (hub == null || token == null) {
            socketState = "no_token"
            SpikeLog.ev("no_token")
            updateStatus("No hub URL / token — configure the app")
            return
        }
        val pingS = SpikeStore.pingS(this)
        val c = OkHttpClient.Builder()
            .pingInterval(pingS.toLong(), TimeUnit.SECONDS)
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(false)
            .build()
        client?.dispatcher?.executorService?.shutdown()
        client = c
        val url = hub.replaceFirst("http://", "ws://").replaceFirst("https://", "wss://") + "/ws"
        val gen = ++wsGen
        authedFirstFrame = false
        socketState = "connecting"
        updateStatus("Connecting to $hub")
        SpikeLog.ev("socket_connecting", mapOf("url" to url, "attempt" to attempt, "ping_s" to pingS))
        worker.postDelayed({
            if (gen == wsGen && !authedFirstFrame && ws != null) {
                SpikeLog.ev("first_frame_timeout", mapOf("timeout_ms" to FIRST_FRAME_TIMEOUT_MS))
                ws?.cancel()
                onClosed(1006, "no first frame in ${FIRST_FRAME_TIMEOUT_MS} ms")
            }
        }, FIRST_FRAME_TIMEOUT_MS)
        ws = c.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                worker.post {
                    if (gen != wsGen) return@post
                    SpikeLog.ev("socket_open")
                    val auth = JSONObject().put("type", "auth").put("device_token", token)
                    webSocket.send(auth.toString())
                    SpikeLog.ev("auth_sent")
                    socketState = "authing"
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val now = System.currentTimeMillis()
                worker.post { if (gen == wsGen) onFrame(webSocket, text, now) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, null)
                worker.post { if (gen == wsGen) onClosed(code, reason) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                worker.post { if (gen == wsGen) onClosed(code, reason) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                worker.post { if (gen == wsGen) onClosed(1006, "failure: ${t.javaClass.simpleName}: ${t.message}") }
            }
        })
    }

    private fun onClosed(code: Int, reason: String) {
        if (ws == null && socketState == "closed") return
        ws = null
        socketState = "closed"
        lastClose = "$code $reason"
        SpikeLog.ev("socket_closed", mapOf("code" to code, "reason" to reason))
        when (code) {
            4401, 4403 -> {
                SpikeStore.clearToken(this)
                updateStatus("Token refused ($code) — re-pair")
                stopSelfFinal("token_refused_$code")
            }
            4426 -> { updateStatus("Upgrade required (4426)"); stopSelfFinal("upgrade_required") }
            4409 -> { updateStatus("Replaced by another socket for this device (4409)"); stopSelfFinal("replaced_4409") }
            else -> scheduleReconnect()
        }
    }

    private fun stopSelfFinal(why: String) {
        SpikeLog.ev("service_stop_final", mapOf("why" to why))
        SpikeStore.setWantRunning(this, false)
        stopped = true
        stopSelf()
    }

    private fun scheduleReconnect() {
        if (stopped) return
        val delay = BACKOFF_MS[attempt.coerceAtMost(BACKOFF_MS.size - 1)]
        attempt++
        reconnects++
        SpikeLog.ev("reconnect_scheduled", mapOf("delay_ms" to delay, "attempt" to attempt))
        updateStatus("Reconnecting in ${delay} ms (last: $lastClose)")
        worker.postDelayed({ if (ws == null && !stopped) connect() }, delay)
    }

    private fun reconnectNow(why: String) {
        if (stopped) return
        // Only short-cut a pending backoff wait; a socket that is connecting or up is left alone.
        if (ws != null) return
        SpikeLog.ev("reconnect_now", mapOf("why" to why))
        worker.removeCallbacksAndMessages(null)
        scheduleHeartbeat()
        attempt = 0
        connect()
    }

    // ------------------------------------------------------------------ frames

    private fun onFrame(webSocket: WebSocket, text: String, receivedAt: Long) {
        lastFrameAt = receivedAt
        val o = try { JSONObject(text) } catch (e: Exception) { SpikeLog.ev("bad_frame"); return }
        val type = o.optString("type")
        if (!authedFirstFrame) {
            authedFirstFrame = true
            attempt = 0 // backoff reset after the first frame following auth (01d §8.1)
            socketState = "up"
            SpikeLog.ev("first_frame", mapOf("type" to type))
            updateStatus("Connected")
        }
        when (type) {
            "alerts_open" -> {
                val arr = o.optJSONArray("alerts")
                SpikeLog.ev("frame", mapOf("type" to type, "count" to (arr?.length() ?: 0), "binding_route_until" to o.opt("binding_route_until")))
                if (arr != null) for (i in 0 until arr.length()) onAlert(webSocket, arr.getJSONObject(i), "alerts_open", receivedAt)
            }
            "alert" -> {
                SpikeLog.ev("frame", mapOf("type" to type))
                onAlert(webSocket, o.getJSONObject("alert"), "alert", receivedAt)
            }
            else -> SpikeLog.ev("frame", mapOf("type" to type, "alert_id" to o.opt("alert_id")))
        }
    }

    private fun onAlert(webSocket: WebSocket, a: JSONObject, via: String, receivedAt: Long) {
        val alertId = a.getString("alert_id")
        val step = a.optInt("step", 0)
        alertsReceived++
        SpikeLog.ev(
            "alert_received",
            mapOf(
                "alert_id" to alertId, "step" to step, "raised_at" to a.opt("raised_at"),
                "family" to a.optString("family"), "kind" to a.optString("kind"), "via" to via,
                "recv_t" to receivedAt,
            ),
        )
        if (!SpikeStore.markIfNew(this, alertId, step)) {
            SpikeLog.ev("duplicate_dropped", mapOf("alert_id" to alertId, "step" to step, "via" to via))
            return
        }
        notifyAlert(alertId, step, a)
        SpikeLog.ev("notified", mapOf("alert_id" to alertId, "step" to step))
        val receipt = JSONObject().put("type", "receipt").put("alert_id", alertId).put("kind", "delivered").put("step", step)
        val ok = webSocket.send(receipt.toString())
        SpikeLog.ev("receipt_sent", mapOf("alert_id" to alertId, "step" to step, "queued" to ok))
    }

    private fun lockText(a: JSONObject): String {
        val lock = a.optJSONObject("lock") ?: return a.optString("kind", "Alert")
        val parts = mutableListOf<String>()
        for (k in listOf("table_code", "point_code", "requester_name", "device_name")) {
            val v = lock.opt(k)
            if (v != null && v != JSONObject.NULL && v.toString().isNotBlank()) parts.add(v.toString())
        }
        parts.add(lock.optString("kind_label_key", a.optString("kind")))
        return parts.joinToString(" · ")
    }

    private fun notifyAlert(alertId: String, step: Int, a: JSONObject) {
        val nm = getSystemService(NotificationManager::class.java)
        val urgent = a.optString("family") == "urgent" || SpikeStore.bool(this, SpikeStore.T_URGENT)
        val text = lockText(a)
        val openApp = PendingIntent.getActivity(
            this, 0, packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val b = NotificationCompat.Builder(this, CH_ALERT)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("POS alert (step $step)")
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(if (urgent) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(openApp)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
        var fsiAllowed: Boolean? = null
        if (urgent) {
            fsiAllowed = if (Build.VERSION.SDK_INT >= 34) nm.canUseFullScreenIntent() else true
            val fsi = Intent(this, FullScreenAlertActivity::class.java)
                .putExtra("text", text).putExtra("alert_id", alertId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            val pi = PendingIntent.getActivity(this, notifId, fsi, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            b.setFullScreenIntent(pi, true)
        }
        val enabled = nm.areNotificationsEnabled()
        nm.notify(notifId++, b.build())
        SpikeLog.ev(
            "notify_posted",
            mapOf(
                "alert_id" to alertId, "step" to step, "urgent" to urgent, "fsi_allowed" to fsiAllowed,
                "notifications_enabled" to enabled, "interruption_filter" to nm.currentInterruptionFilter,
            ),
        )
    }

    // ------------------------------------------------------------------ locks, network, heartbeat

    @SuppressLint("WakelockTimeout")
    private fun applyLocks() {
        releaseLocks()
        if (SpikeStore.bool(this, SpikeStore.T_WAKE_LOCK)) {
            val pm = getSystemService(PowerManager::class.java)
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pos-spike:alerts").also { it.acquire() }
        }
        if (SpikeStore.bool(this, SpikeStore.T_WIFI_LOCK)) {
            val wm = applicationContext.getSystemService(WifiManager::class.java)
            @Suppress("DEPRECATION")
            val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
            wifiLock = wm.createWifiLock(mode, "pos-spike:alerts").also { it.acquire() }
        }
        SpikeLog.ev("locks_applied", mapOf("wake_lock" to (wakeLock != null), "wifi_lock" to (wifiLock != null)))
    }

    private fun releaseLocks() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        wifiLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
    }

    private fun registerNetworkCallback() {
        if (netCallback != null) return
        val cm = getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                worker.post {
                    SpikeLog.ev("network_available")
                    reconnectNow("network_available")
                }
            }

            override fun onLost(network: Network) {
                worker.post { SpikeLog.ev("network_lost") }
            }
        }
        val req = NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) // LAN-only: no internet needed
            .build()
        try {
            cm.registerNetworkCallback(req, cb)
            netCallback = cb
        } catch (e: Exception) {
            SpikeLog.ev("network_callback_failed", mapOf("error" to e.toString()))
        }
    }

    private fun unregisterNetworkCallback() {
        val cb = netCallback ?: return
        try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(cb) } catch (_: Exception) {}
        netCallback = null
    }

    private fun scheduleHeartbeat() {
        worker.postDelayed(object : Runnable {
            override fun run() {
                if (stopped) return
                heartbeat()
                worker.postDelayed(this, HEARTBEAT_MS)
            }
        }, 1000)
    }

    private fun heartbeat() {
        val pm = getSystemService(PowerManager::class.java)
        val bm = getSystemService(BatteryManager::class.java)
        val wm = applicationContext.getSystemService(WifiManager::class.java)
        @Suppress("DEPRECATION")
        val rssi = try { wm.connectionInfo?.rssi } catch (_: Exception) { null }
        SpikeLog.ev(
            "heartbeat",
            mapOf(
                "socket" to socketState, "last_frame_age_ms" to (if (lastFrameAt == 0L) null else System.currentTimeMillis() - lastFrameAt),
                "screen_on" to pm.isInteractive, "device_idle_mode" to pm.isDeviceIdleMode, "power_save" to pm.isPowerSaveMode,
                "ignoring_battery_optimizations" to pm.isIgnoringBatteryOptimizations(packageName),
                "battery_pct" to bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY), "charging" to bm.isCharging,
                "wifi_rssi" to rssi, "held_wake_lock" to (wakeLock?.isHeld == true), "held_wifi_lock" to (wifiLock?.isHeld == true),
                "toggles" to SpikeStore.toggles(this).toString(), "alerts_received" to alertsReceived, "reconnects" to reconnects,
            ),
        )
    }

    // ------------------------------------------------------------------ notifications

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_STATUS, "Alert connection", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_ALERT, "POS alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 600, 200, 600)
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setBypassDnd(true)
            },
        )
    }

    private fun statusNotification(text: String): Notification {
        val openApp = PendingIntent.getActivity(
            this, 1, packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CH_STATUS)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("POS alerts")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openApp)
            .build()
    }

    private fun goForeground(text: String) {
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        try {
            ServiceCompat.startForeground(this, NOTIF_STATUS, statusNotification(text), type)
        } catch (e: Exception) {
            // e.g. ForegroundServiceStartNotAllowedException from boot on some versions — record it (spike data).
            SpikeLog.ev("start_foreground_failed", mapOf("error" to e.toString()))
            throw e
        }
    }

    private fun updateStatus(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_STATUS, statusNotification(text))
    }
}
