package pos.tablet

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import java.util.concurrent.Executors

/**
 * 05b M-4, M-5, M-19, §3.5: the foreground service in process `:alerts` holding the 01d alert-mode socket
 * (device token only). Android glue only: the connection is [AlertSocket], the alert pipeline [AlertIntake],
 * the close-code rule [CloseCodes]; all of their state lives on one worker thread.
 */
class AlertService : Service() {

    companion object {
        const val EXTRA_REASON = "reason"
        const val REASON_WATCHDOG = "watchdog_check" // A13's alarm uses this
        private const val HEARTBEAT_MS = 5 * 60 * 1000L

        /** The running instance in this process (read by AlertsReceiver for health / wake lock). */
        @Volatile var instance: AlertService? = null
            private set

        fun start(ctx: Context, reason: String) {
            val i = Intent(ctx, AlertService::class.java).putExtra(EXTRA_REASON, reason)
            try {
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) {
                // e.g. ForegroundServiceStartNotAllowedException (31+) from a background start; A13's watchdog retries.
                AlertLog.ev("service_start_refused", mapOf("reason" to reason, "error" to e.toString()))
            }
        }

        /** §3.5 confirmed revoke (socket close or confirmRevoked): clear, stop, `state { paired: false }`. */
        fun revoked(ctx: Context, reason: String) {
            AlertLog.ev("revoked", mapOf("reason" to reason))
            AlertsStore.clearToken(ctx)
            AlertsStore.setWantRunning(ctx, false)
            IpcReply.state(ctx, paired = false, alertSocket = "down", bindingRouteUntil = null)
            ctx.stopService(Intent(ctx, AlertService::class.java))
        }
    }

    // M-18 health, published from the worker.
    @Volatile var alertSocket: String = "down"
        private set
    @Volatile var lastFrameAt: Long = 0
        private set
    @Volatile var replacedByOther: Boolean = false
        private set
    @Volatile var bindingRouteUntil: Long? = null
        private set
    val wakeLockHeld: Boolean get() = wakeLock?.isHeld == true

    private lateinit var worker: ExecutorWorker
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "pos-alerts-io").apply { isDaemon = true } }
    private lateinit var notifier: Notifier
    private val transport = OkHttpTransport()
    private lateinit var socket: AlertSocket
    private var intake: AlertIntake? = null
    private var statusText: String? = null
    private var heartbeatOn = false
    private var stopped = false

    @Volatile private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        AlertLog.init(filesDir)
        notifier = Notifier(this)
        try { notifier.createChannels() } catch (e: Exception) { AlertLog.ev("channels_failed", mapOf("error" to e.toString())) }
        worker = ExecutorWorker("pos-alerts")
        socket = AlertSocket(worker, transport, callbacks)
        instance = this
        // N-1: the page re-sends setSession / setDeviceContext (the plugin emits state { needs_context: true }).
        IpcReply.serviceStarted(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val reason = intent?.getStringExtra(EXTRA_REASON) ?: if (intent == null) "sticky_restart" else "unknown"
        if (!goForeground("Connecting…")) {
            stopSelf()
            return START_NOT_STICKY
        }
        AlertLog.ev("service_start", mapOf("reason" to reason, "sdk" to Build.VERSION.SDK_INT))
        val origin = AlertsStore.hubOrigin(this)
        val token = AlertsStore.token(this)
        if (origin.isNullOrEmpty() || token.isNullOrEmpty()) {
            // M-22: no token, or a store that throws → not paired (health shows store_readable false).
            AlertLog.ev("not_paired", mapOf("store_readable" to AlertsStore.storeReadable(this)))
            AlertsStore.setWantRunning(this, false)
            IpcReply.state(this, paired = false, alertSocket = "down", bindingRouteUntil = null)
            stopSelf()
            return START_NOT_STICKY
        }
        AlertsStore.setWantRunning(this, true)
        // 05b A13: (re)arm the watchdog on every start (M-6).
        Watchdog.schedule(this)
        worker.post {
            if (stopped) return@post
            ensureIntake()
            if (reason == REASON_WATCHDOG) {
                if (AlertsStore.wakeLock(this) && wakeLock?.isHeld != true) applyLocks()
                socket.start(origin, token)
                socket.ensureConnected()
                heartbeat()
            } else {
                applyLocks()
                registerNetworkCallback()
                socket.start(origin, token)
            }
            scheduleHeartbeat()
        }
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        AlertLog.ev("task_removed")
        // 05b A13: arm the watchdog in 2 s so a swipe-away that kills the process is recovered (M-6).
        if (AlertsStore.wantRunning(this)) Watchdog.schedule(this, Spec.TASK_REMOVED_WATCHDOG_MS)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        AlertLog.ev("service_destroyed")
        instance = null
        worker.post {
            stopped = true
            socket.stop()
            releaseLocks()
            unregisterNetworkCallback()
            transport.shutdown()
            io.shutdownNow()
            worker.shutdown()
        }
        super.onDestroy()
    }

    /** SET_WAKE_LOCK (M-5, OQ-3): re-apply after the setting changed. */
    fun applyLocksAsync() = worker.post { if (!stopped) applyLocks() }

    // ------------------------------------------------------------------ socket glue

    private fun ensureIntake() {
        if (intake != null) return
        intake = AlertIntake(
            Dedupe(AlertsStore.dedupeStore(this)),
            OpenUrgent(AlertsStore.openUrgentStore(this)),
            sink,
            System::currentTimeMillis,
        )
    }

    /** A10 / A11: the open unseen urgent set (worker thread only). */
    fun openUrgent(): OpenUrgent? = intake?.openUrgent

    private val sink = object : IntakeSink {
        override fun isSilentKind(item: AlertItem): Boolean =
            try { LockText.isSilent(this@AlertService, item.kind) } catch (_: Exception) { false }
        override fun post(item: AlertItem, withSound: Boolean) =
            notifier.post(item, withSound, AlertsStore.language(this@AlertService))
        override fun cancel(alertId: String) = notifier.cancel(alertId)
        override fun send(text: String): Boolean = socket.send(text)
        override fun log(ev: String, fields: Map<String, Any?>) = AlertLog.ev(ev, fields)
    }

    private val callbacks = object : SocketCallbacks {
        override fun onState(state: SocketState) {
            lastFrameAt = state.lastFrameAt
            replacedByOther = state.replacedByOther
            if (state.statusText != statusText) {
                statusText = state.statusText
                notifier.updateStatus(state.statusText)
            }
            if (state.alertSocket != alertSocket) {
                alertSocket = state.alertSocket
                if (state.phase != Phase.STOPPED) broadcastState()
            }
        }

        override fun onFrame(text: String, recvT: Long) {
            val frame = Frames.parse(text)
            when (frame) {
                is Frame.AlertsOpen -> {
                    AlertLog.ev("frame", mapOf("type" to "alerts_open", "count" to frame.rows.size, "bad_rows" to frame.badRows))
                    setBindingRoute(frame.bindingRouteUntil)
                }
                is Frame.BindingRoute -> setBindingRoute(frame.until)
                is Frame.Ignored -> AlertLog.ev("frame_ignored", mapOf("type" to frame.type, "why" to frame.why))
                is Frame.Alert -> AlertLog.ev("frame", mapOf("type" to "alert"))
                is Frame.Seen -> AlertLog.ev("frame", mapOf("type" to "alert_seen", "alert_id" to frame.alertId))
                is Frame.Closed -> AlertLog.ev("frame", mapOf("type" to "alert_closed", "alert_id" to frame.alertId))
            }
            ensureIntake()
            intake?.onFrame(frame, recvT)
        }

        override fun checkToken(origin: String, token: String, done: (CloseCodes.Check) -> Unit) {
            val checker = TokenCheck(BuildConfig.VERSION_NAME)
            try {
                io.execute { done(checker.check(origin, token)) }
            } catch (e: Exception) {
                done(CloseCodes.Check.Unreachable)
            }
        }

        override fun onRevoked(reason: String) {
            stopped = true
            revoked(this@AlertService, reason)
        }

        override fun onUpgradeRequired() {
            // 05b A14: 4426 → checkForUpdate() (M-15); the socket keeps reconnecting with backoff.
            Updates.client(this@AlertService).checkAsync("upgrade_required")
        }

        override fun onNewSocket() {
            intake?.onNewSocket()
            // 05b A14: update check after each reconnect (first frame, M-15).
            Updates.client(this@AlertService).checkAsync("reconnect")
        }

        override fun log(ev: String, fields: Map<String, Any?>) = AlertLog.ev(ev, fields)
    }

    private fun setBindingRoute(until: Long?) {
        if (until == bindingRouteUntil) return
        bindingRouteUntil = until
        broadcastState()
    }

    private fun broadcastState() =
        IpcReply.state(this, paired = AlertsStore.paired(this), alertSocket = alertSocket, bindingRouteUntil = bindingRouteUntil)

    // ------------------------------------------------------------------ foreground, locks, network

    private fun goForeground(text: String): Boolean {
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        return try {
            ServiceCompat.startForeground(this, Notifier.STATUS_ID, notifier.statusNotification(text), type)
            true
        } catch (e: Exception) {
            // ForegroundServiceStartNotAllowedException (31+) and friends: log; the watchdog (A13) retries.
            AlertLog.ev("start_foreground_failed", mapOf("error" to e.toString()))
            false
        }
    }

    @SuppressLint("WakelockTimeout")
    private fun applyLocks() {
        releaseLocks()
        if (AlertsStore.wakeLock(this)) {
            try {
                val pm = getSystemService(PowerManager::class.java)
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pos:alerts").also {
                    it.setReferenceCounted(false)
                    it.acquire()
                }
            } catch (e: Exception) { AlertLog.ev("wake_lock_failed", mapOf("error" to e.toString())) }
        }
        // M-5 / N-11: WIFI_MODE_FULL_HIGH_PERF up to API 33; on 34+ it maps to LOW_LATENCY (no effect with the
        // screen off), so no WifiLock there.
        if (Build.VERSION.SDK_INT < 34) {
            try {
                val wm = applicationContext.getSystemService(WifiManager::class.java)
                @Suppress("DEPRECATION")
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "pos:alerts").also {
                    it.setReferenceCounted(false)
                    it.acquire()
                }
            } catch (e: Exception) { AlertLog.ev("wifi_lock_failed", mapOf("error" to e.toString())) }
        }
        AlertLog.ev("locks_applied", mapOf("wake_lock" to (wakeLock?.isHeld == true), "wifi_lock" to (wifiLock?.isHeld == true)))
    }

    private fun releaseLocks() {
        try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
        wakeLock = null
        try { wifiLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
        wifiLock = null
    }

    private fun registerNetworkCallback() {
        if (netCallback != null) return
        val cm = getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = worker.post { if (!stopped) socket.onNetworkAvailable() }
            override fun onLost(network: Network) = worker.post { AlertLog.ev("network_lost") }
        }
        // LAN only: INTERNET capability, VALIDATED not required (M-4).
        val req = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            .build()
        try {
            cm.registerNetworkCallback(req, cb)
            netCallback = cb
        } catch (e: Exception) {
            AlertLog.ev("network_callback_failed", mapOf("error" to e.toString()))
        }
    }

    private fun unregisterNetworkCallback() {
        val cb = netCallback ?: return
        try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(cb) } catch (_: Exception) {}
        netCallback = null
    }

    private fun scheduleHeartbeat() {
        if (heartbeatOn) return
        heartbeatOn = true
        fun loop() {
            worker.postDelayed(HEARTBEAT_MS) {
                if (stopped) return@postDelayed
                heartbeat()
                loop()
            }
        }
        loop()
    }

    private fun heartbeat() {
        val fields = HashMap<String, Any?>()
        try {
            val pm = getSystemService(PowerManager::class.java)
            val bm = getSystemService(BatteryManager::class.java)
            fields["socket"] = socket.phase.name
            fields["last_frame_age_ms"] = if (lastFrameAt == 0L) null else System.currentTimeMillis() - lastFrameAt
            fields["screen_on"] = pm.isInteractive
            fields["device_idle_mode"] = pm.isDeviceIdleMode
            fields["power_save"] = pm.isPowerSaveMode
            fields["ignoring_battery_optimizations"] = pm.isIgnoringBatteryOptimizations(packageName)
            fields["battery_pct"] = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            fields["charging"] = bm.isCharging
            fields["held_wake_lock"] = wakeLock?.isHeld == true
            fields["held_wifi_lock"] = wifiLock?.isHeld == true
            fields["open_urgent"] = intake?.openUrgent?.snapshot()?.size
        } catch (e: Exception) {
            fields["error"] = e.toString()
        }
        AlertLog.ev("heartbeat", fields)
    }
}
