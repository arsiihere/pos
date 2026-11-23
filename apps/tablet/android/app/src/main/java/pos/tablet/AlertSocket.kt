package pos.tablet

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadFactory
import java.util.concurrent.TimeUnit

// ------------------------------------------------------------------------------------------- seams

fun interface Cancellable { fun cancel() }

/** One thread that owns all socket state (05b M-4). [post] / [postDelayed] run there; never concurrently. */
interface Worker {
    fun post(r: () -> Unit)
    fun postDelayed(delayMs: Long, r: () -> Unit): Cancellable
    /** Wall clock for logs / `recv_t` (M-19). */
    fun wallNow(): Long
}

/** The real worker: a single-thread scheduled executor (plain JVM, so the real path is unit-tested too). */
class ExecutorWorker(name: String) : Worker {
    private val exec = ScheduledThreadPoolExecutor(1, ThreadFactory { r -> Thread(r, name).apply { isDaemon = true } }).apply {
        removeOnCancelPolicy = true
    }

    override fun post(r: () -> Unit) {
        if (exec.isShutdown) return
        exec.execute(Runnable { safely(r) })
    }

    override fun postDelayed(delayMs: Long, r: () -> Unit): Cancellable {
        if (exec.isShutdown) return Cancellable {}
        val f = exec.schedule(Runnable { safely(r) }, delayMs, TimeUnit.MILLISECONDS)
        return Cancellable { f.cancel(false) }
    }

    override fun wallNow(): Long = System.currentTimeMillis()

    fun shutdown() = exec.shutdownNow()

    private fun safely(r: () -> Unit) {
        try { r() } catch (e: Throwable) { AlertLog.ev("worker_error", mapOf("error" to e.toString())) }
    }
}

interface Conn {
    fun send(text: String): Boolean
    fun cancel()
    fun close(code: Int, reason: String?)
}

/** Raw transport events, called on any thread; [AlertSocket] moves them onto its worker. */
interface ConnListener {
    fun onOpen()
    fun onMessage(text: String)
    fun onClosed(code: Int, reason: String)
    fun onFailure(t: Throwable)
}

fun interface Transport {
    fun connect(url: String, listener: ConnListener): Conn
}

/** OkHttp WebSocket transport: ping every Spec.PING_S s, connect timeout 5 s, no read timeout (M-4). */
class OkHttpTransport(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .pingInterval(Spec.PING_S, TimeUnit.SECONDS)
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(false)
        .build(),
) : Transport {
    override fun connect(url: String, listener: ConnListener): Conn {
        val ws = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = listener.onOpen()
            override fun onMessage(webSocket: WebSocket, text: String) = listener.onMessage(text)
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, null) // answer the hub's close, then treat it as closed
                listener.onClosed(code, reason)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = listener.onClosed(code, reason)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = listener.onFailure(t)
        })
        return object : Conn {
            override fun send(text: String) = ws.send(text)
            override fun cancel() = ws.cancel()
            override fun close(code: Int, reason: String?) { ws.close(code, reason) }
        }
    }

    fun shutdown() {
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }
}

// ------------------------------------------------------------------------------------------- machine

enum class Phase { IDLE, CONNECTING, AUTHING, UP, WAITING, CHECKING, REPLACED_WAIT, STOPPED }

data class SocketState(
    val phase: Phase,
    /** §4.2 `state.alert_socket`. */
    val alertSocket: String,
    /** Status notification text (M-4, §3.5 reason texts). */
    val statusText: String,
    val replacedByOther: Boolean,
    val lastFrameAt: Long,
)

/** What the socket needs from the service. Called on the worker thread. */
interface SocketCallbacks {
    fun onState(state: SocketState)
    fun onFrame(text: String, recvT: Long)
    /** Runs the §3.5 HTTP check off the worker and calls [done] (any thread). */
    fun checkToken(origin: String, token: String, done: (CloseCodes.Check) -> Unit)
    /** Revoke confirmed: clear the token, stop the service, `state { paired: false }`. */
    fun onRevoked(reason: String)
    /** 4426: A14 runs checkForUpdate() here; the socket keeps reconnecting with backoff. */
    fun onUpgradeRequired()
    /** A new socket opened (receipts once per key per socket restart here). */
    fun onNewSocket()
    fun log(ev: String, fields: Map<String, Any?> = emptyMap())
}

/**
 * 05b M-4 + §3.5: the alert-mode connection as a single-threaded state machine. Every public method and
 * every transport event runs on [worker]. `auth { device_token }` only (no session token, §2); the first
 * frame must come within Spec.FIRST_FRAME_TIMEOUT_MS of the connect or the socket is cancelled and treated as
 * 1006 (a stopping hub can accept TCP and never answer the upgrade, §3.3); backoff Spec.BACKOFF_MS, reset at the
 * first frame after auth; a generation counter drops callbacks of an old socket; a network becoming available
 * cuts a pending backoff wait short.
 */
class AlertSocket(
    private val worker: Worker,
    private val transport: Transport,
    private val cb: SocketCallbacks,
) {
    private var origin: String? = null
    private var token: String? = null
    private var gen = 0
    private var conn: Conn? = null
    private var firstFrame = false
    private var firstFrameTimer: Cancellable? = null
    private var pending: Cancellable? = null
    private var reasonText: String? = null

    var attempt = 0
        private set
    var phase = Phase.IDLE
        private set
    var replacedByOther = false
        private set
    var lastFrameAt = 0L
        private set

    companion object {
        /** `http://host:port` → `ws://host:port/ws` (https → wss). Null if not an http(s) origin. */
        fun wsUrl(origin: String): String? {
            val o = origin.trim().trimEnd('/')
            return when {
                o.startsWith("http://") -> "ws://" + o.removePrefix("http://") + "/ws"
                o.startsWith("https://") -> "wss://" + o.removePrefix("https://") + "/ws"
                else -> null
            }
        }

        fun alertSocketOf(p: Phase): String = when (p) {
            Phase.UP -> "up"
            Phase.CONNECTING, Phase.AUTHING -> "connecting"
            else -> "down"
        }
    }

    fun state(): SocketState = SocketState(phase, alertSocketOf(phase), statusText(), replacedByOther, lastFrameAt)

    private fun statusText(): String = reasonText ?: when (phase) {
        Phase.UP -> "Connected"
        Phase.CONNECTING, Phase.AUTHING -> "Connecting…"
        Phase.WAITING, Phase.CHECKING, Phase.IDLE -> "Reconnecting…"
        Phase.REPLACED_WAIT -> "Replaced by another connection"
        Phase.STOPPED -> "Not paired"
    }

    /** (Re)starts with these credentials. Same credentials and a live or pending socket → nothing. */
    fun start(origin: String?, token: String?) {
        val same = origin == this.origin && token == this.token
        this.origin = origin
        this.token = token
        if (same && phase != Phase.IDLE && phase != Phase.STOPPED) return
        dropCurrent()
        attempt = 0
        connect()
    }

    /** Stops for good (service stop, revoke). */
    fun stop() {
        val c = conn
        conn = null
        dropCurrent()
        c?.close(1000, "service stopped")
        phase = Phase.STOPPED
        emit()
    }

    /** M-4: NetworkCallback.onAvailable → reconnect at once if waiting on backoff. */
    fun onNetworkAvailable() {
        cb.log("network_available", mapOf("phase" to phase.name))
        if (phase != Phase.WAITING) return
        pending?.cancel()
        pending = null
        attempt = 0
        connect()
    }

    /** Watchdog (M-6): reconnect now if not connected and not deliberately waiting (replaced / checking). */
    fun ensureConnected() {
        if (phase == Phase.WAITING || phase == Phase.IDLE) {
            pending?.cancel()
            pending = null
            connect()
        }
    }

    /** Sends on the live socket (receipts only, §2). */
    fun send(text: String): Boolean = if (phase == Phase.UP) conn?.send(text) ?: false else false

    // -------------------------------------------------------------------------------- internals

    private fun dropCurrent() {
        gen++
        firstFrameTimer?.cancel(); firstFrameTimer = null
        pending?.cancel(); pending = null
        conn?.let { it.cancel() }
        conn = null
    }

    private fun connect() {
        val o = origin
        val t = token
        val url = o?.let { wsUrl(it) }
        if (url == null || t.isNullOrEmpty()) {
            phase = Phase.STOPPED
            reasonText = null
            cb.log("no_token")
            emit()
            return
        }
        val g = ++gen
        firstFrame = false
        phase = Phase.CONNECTING
        cb.log("socket_connecting", mapOf("url" to url, "attempt" to attempt))
        emit()
        firstFrameTimer = worker.postDelayed(Spec.FIRST_FRAME_TIMEOUT_MS) {
            if (g == gen && !firstFrame && conn != null) {
                cb.log("first_frame_timeout", mapOf("timeout_ms" to Spec.FIRST_FRAME_TIMEOUT_MS))
                val c = conn
                conn = null
                c?.cancel()
                closed(1006, "no first frame in ${Spec.FIRST_FRAME_TIMEOUT_MS} ms")
            }
        }
        conn = try {
            transport.connect(url, listenerFor(g))
        } catch (e: Exception) {
            cb.log("socket_connect_failed", mapOf("error" to e.toString()))
            firstFrameTimer?.cancel(); firstFrameTimer = null
            closed(1006, "connect failed: ${e.javaClass.simpleName}")
            null
        }
    }

    private fun listenerFor(g: Int) = object : ConnListener {
        override fun onOpen() = worker.post { if (g == gen) opened() }
        override fun onMessage(text: String) {
            val recvT = worker.wallNow()
            worker.post { if (g == gen) message(text, recvT) }
        }
        override fun onClosed(code: Int, reason: String) = worker.post { if (g == gen) terminal(code, reason) }
        override fun onFailure(t: Throwable) = worker.post {
            if (g == gen) terminal(1006, "failure: ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    private fun opened() {
        val c = conn ?: return
        cb.log("socket_open")
        val auth = JSONObject().put("type", "auth").put("device_token", token)
        c.send(auth.toString())
        cb.log("auth_sent")
        phase = Phase.AUTHING
        emit()
    }

    private fun message(text: String, recvT: Long) {
        if (conn == null) return
        lastFrameAt = recvT
        if (!firstFrame) {
            firstFrame = true
            attempt = 0 // M-4: reset at the first frame after auth
            firstFrameTimer?.cancel(); firstFrameTimer = null
            phase = Phase.UP
            reasonText = null
            replacedByOther = false
            cb.log("first_frame")
            cb.onNewSocket()
            emit()
        }
        cb.onFrame(text, recvT)
    }

    private fun terminal(code: Int, reason: String) {
        if (conn == null) return // already handled (onClosing then onClosed, or a timeout)
        conn = null
        firstFrameTimer?.cancel(); firstFrameTimer = null
        closed(code, reason)
    }

    private fun closed(code: Int, reason: String) {
        cb.log("socket_closed", mapOf("code" to code, "reason" to reason))
        when (CloseCodes.decide(code)) {
            CloseCodes.Action.RECONNECT -> backoff()
            CloseCodes.Action.UPGRADE_REQUIRED -> {
                cb.log("upgrade_required")
                cb.onUpgradeRequired()
                backoff()
            }
            CloseCodes.Action.REPLACED -> {
                replacedByOther = true
                phase = Phase.REPLACED_WAIT
                cb.log("reconnect_scheduled", mapOf("delay_ms" to Spec.REPLACED_RECONNECT_MS, "why" to "replaced"))
                emit()
                pending = worker.postDelayed(Spec.REPLACED_RECONNECT_MS) {
                    if (phase == Phase.REPLACED_WAIT) { pending = null; connect() }
                }
            }
            CloseCodes.Action.CHECK_TOKEN -> {
                val o = origin
                val t = token
                if (o == null || t == null) { backoff(); return }
                phase = Phase.CHECKING
                emit()
                val g = gen
                cb.log("token_check", mapOf("code" to code))
                cb.checkToken(o, t) { result ->
                    worker.post { if (g == gen && phase == Phase.CHECKING) checked(result) }
                }
            }
        }
    }

    private fun checked(result: CloseCodes.Check) {
        cb.log("token_check_result", mapOf("result" to result.javaClass.simpleName, "reason" to result.reason))
        when (result) {
            is CloseCodes.Check.Revoked -> {
                token = null
                phase = Phase.STOPPED
                reasonText = null
                emit()
                cb.onRevoked(result.reason ?: "DEVICE_REVOKED")
            }
            else -> {
                reasonText = CloseCodes.statusText(result)
                backoff()
            }
        }
    }

    private fun backoff() {
        val delay = Spec.BACKOFF_MS[attempt.coerceAtMost(Spec.BACKOFF_MS.size - 1)]
        attempt++
        phase = Phase.WAITING
        cb.log("reconnect_scheduled", mapOf("delay_ms" to delay, "attempt" to attempt))
        emit()
        pending = worker.postDelayed(delay) {
            if (phase == Phase.WAITING) { pending = null; connect() }
        }
    }

    private fun emit() = cb.onState(state())
}
