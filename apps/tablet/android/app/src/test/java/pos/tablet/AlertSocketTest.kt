package pos.tablet

import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

// ------------------------------------------------------------------------------------------- fakes

class FakeWorker : Worker {
    var now = 0L
    private var seq = 0
    private class Task(val at: Long, val seq: Int, val r: () -> Unit)
    private val tasks = ArrayList<Task>()

    override fun post(r: () -> Unit) = r()
    override fun postDelayed(delayMs: Long, r: () -> Unit): Cancellable {
        val t = Task(now + delayMs, seq++, r)
        tasks.add(t)
        return Cancellable { tasks.remove(t) }
    }
    override fun wallNow(): Long = now

    fun advance(ms: Long) {
        val end = now + ms
        while (true) {
            val next = tasks.filter { it.at <= end }.minWithOrNull(compareBy<Task>({ it.at }, { it.seq })) ?: break
            tasks.remove(next)
            now = next.at
            next.r()
        }
        now = end
    }
}

class FakeConn(val url: String, val listener: ConnListener) : Conn {
    val sent = ArrayList<String>()
    var cancelled = false
    var closedWith: Int? = null
    override fun send(text: String): Boolean { sent.add(text); return true }
    override fun cancel() { cancelled = true }
    override fun close(code: Int, reason: String?) { closedWith = code }
}

class FakeTransport : Transport {
    val conns = ArrayList<FakeConn>()
    override fun connect(url: String, listener: ConnListener): Conn = FakeConn(url, listener).also { conns.add(it) }
    val last: FakeConn get() = conns.last()
}

class FakeCallbacks : SocketCallbacks {
    val states = ArrayList<SocketState>()
    val frames = ArrayList<String>()
    val checks = ArrayList<(CloseCodes.Check) -> Unit>()
    val revoked = ArrayList<String>()
    var upgrades = 0
    var newSockets = 0
    val logs = ArrayList<Pair<String, Map<String, Any?>>>()
    override fun onState(state: SocketState) { states.add(state) }
    override fun onFrame(text: String, recvT: Long) { frames.add(text) }
    override fun checkToken(origin: String, token: String, done: (CloseCodes.Check) -> Unit) { checks.add(done) }
    override fun onRevoked(reason: String) { revoked.add(reason) }
    override fun onUpgradeRequired() { upgrades++ }
    override fun onNewSocket() { newSockets++ }
    override fun log(ev: String, fields: Map<String, Any?>) { logs.add(ev to fields) }
}

/** 05b test 12 (backoff, reset, first-frame timeout, generation guard) and the socket half of test 13. */
class AlertSocketTest {
    private val worker = FakeWorker()
    private val transport = FakeTransport()
    private val cb = FakeCallbacks()
    private val socket = AlertSocket(worker, transport, cb)
    private val origin = "http://10.0.0.5:8080"

    private fun started(): FakeConn { socket.start(origin, "tok-1"); return transport.last }
    private fun up(c: FakeConn) { c.listener.onOpen(); c.listener.onMessage("""{"type":"alerts_open","alerts":[],"binding_route_until":null}""") }

    /** Advances to just before [delay] (no connect) and then to it (one connect). */
    private fun assertReconnectAfter(delay: Long) {
        val n = transport.conns.size
        worker.advance(delay - 1)
        assertEquals("no connect before $delay ms", n, transport.conns.size)
        worker.advance(1)
        assertEquals("connect at $delay ms", n + 1, transport.conns.size)
    }

    @Test fun wsUrlFromOrigin() {
        assertEquals("ws://10.0.0.5:8080/ws", AlertSocket.wsUrl("http://10.0.0.5:8080"))
        assertEquals("ws://10.0.0.5:8080/ws", AlertSocket.wsUrl("http://10.0.0.5:8080/"))
        assertEquals("wss://hub.local:443/ws", AlertSocket.wsUrl("https://hub.local:443"))
        assertNull(AlertSocket.wsUrl("10.0.0.5:8080"))
    }

    @Test fun authIsDeviceTokenOnlyOnOpen() {
        val c = started()
        assertEquals("ws://10.0.0.5:8080/ws", c.url)
        assertTrue(c.sent.isEmpty())
        c.listener.onOpen()
        val auth = JSONObject(c.sent.single())
        assertEquals("auth", auth.getString("type"))
        assertEquals("tok-1", auth.getString("device_token"))
        assertFalse(auth.has("session_token"))
        assertEquals("connecting", socket.state().alertSocket)
    }

    @Test fun upAtFirstFrameAndFramesForwarded() {
        val c = started()
        up(c)
        assertEquals(Phase.UP, socket.phase)
        assertEquals("up", socket.state().alertSocket)
        assertEquals("Connected", socket.state().statusText)
        assertEquals(1, cb.frames.size)
        assertEquals(1, cb.newSockets)
        assertTrue(socket.send("""{"type":"receipt"}"""))
    }

    @Test fun backoffSequenceThenCap() {
        started().listener.onClosed(1006, "x")
        for (d in listOf(500L, 1000L, 2000L, 4000L, 5000L, 5000L, 5000L)) {
            assertEquals(Phase.WAITING, socket.phase)
            assertEquals("down", socket.state().alertSocket)
            assertReconnectAfter(d)
            transport.last.listener.onFailure(RuntimeException("refused"))
        }
    }

    @Test fun backoffResetsAtFirstFrameAfterAuth() {
        started().listener.onClosed(1006, "x")
        assertReconnectAfter(500)
        transport.last.listener.onClosed(1006, "x")
        assertReconnectAfter(1000)
        transport.last.listener.onClosed(1006, "x")
        assertReconnectAfter(2000)
        val c = transport.last
        c.listener.onOpen()
        assertEquals("open alone does not reset", 3, socket.attempt)
        c.listener.onMessage("""{"type":"alerts_open","alerts":[],"binding_route_until":null}""")
        assertEquals(0, socket.attempt)
        c.listener.onClosed(1012, "hub restarting")
        assertReconnectAfter(500)
    }

    @Test fun firstFrameTimeoutCancelsAndReconnects() {
        val c = started()
        c.listener.onOpen() // upgrade answered, but the hub never sends a frame
        worker.advance(Spec.FIRST_FRAME_TIMEOUT_MS - 1)
        assertFalse(c.cancelled)
        worker.advance(1)
        assertTrue(c.cancelled)
        assertEquals(Phase.WAITING, socket.phase)
        assertTrue(cb.logs.any { it.first == "socket_closed" && it.second["code"] == 1006 })
        assertReconnectAfter(500)
    }

    @Test fun firstFrameTimeoutAlsoWithoutUpgrade() {
        val c = started() // TCP accepted, upgrade never answered (§3.3)
        worker.advance(Spec.FIRST_FRAME_TIMEOUT_MS)
        assertTrue(c.cancelled)
        assertEquals(Phase.WAITING, socket.phase)
    }

    @Test fun noTimeoutOnceUp() {
        val c = started()
        up(c)
        worker.advance(Spec.FIRST_FRAME_TIMEOUT_MS * 3)
        assertFalse(c.cancelled)
        assertEquals(Phase.UP, socket.phase)
    }

    @Test fun generationGuardIgnoresOldSocket() {
        val old = started()
        old.listener.onOpen()
        worker.advance(Spec.FIRST_FRAME_TIMEOUT_MS) // old cancelled
        worker.advance(500)
        val fresh = transport.last
        assertTrue(fresh !== old)
        // late callbacks of the old socket change nothing
        old.listener.onMessage("""{"type":"alert_seen","alert_id":"A"}""")
        old.listener.onClosed(4401, "late")
        old.listener.onFailure(RuntimeException("late"))
        assertTrue(cb.frames.isEmpty())
        assertTrue(cb.checks.isEmpty())
        assertEquals(Phase.CONNECTING, socket.phase)
        up(fresh)
        assertEquals(Phase.UP, socket.phase)
        assertEquals(1, cb.frames.size)
    }

    @Test fun closingThenClosedHandledOnce() {
        val c = started()
        up(c)
        c.listener.onClosed(1011, "builder")
        c.listener.onClosed(1011, "builder")
        assertEquals(1, cb.logs.count { it.first == "socket_closed" })
        assertReconnectAfter(500)
    }

    @Test fun networkAvailableCutsBackoffShort() {
        started().listener.onClosed(1006, "x")
        assertReconnectAfter(500)
        transport.last.listener.onClosed(1006, "x") // now waiting 1000 ms
        val n = transport.conns.size
        socket.onNetworkAvailable()
        assertEquals(n + 1, transport.conns.size)
        assertEquals(0, socket.attempt)
        up(transport.last)
        worker.advance(10_000)
        assertEquals("the cancelled backoff does not connect again", n + 1, transport.conns.size)
    }

    @Test fun networkAvailableLeavesALiveSocketAlone() {
        val c = started()
        socket.onNetworkAvailable()
        assertEquals(1, transport.conns.size)
        up(c)
        socket.onNetworkAvailable()
        assertEquals(1, transport.conns.size)
        assertFalse(c.cancelled)
    }

    @Test fun replaced4409ReconnectsAfter60s() {
        val c = started()
        up(c)
        c.listener.onClosed(4409, "replaced")
        assertTrue(socket.replacedByOther)
        assertEquals(Phase.REPLACED_WAIT, socket.phase)
        assertEquals("Replaced by another connection", socket.state().statusText)
        socket.onNetworkAvailable() // does not cut the 60 s short
        assertReconnectAfter(Spec.REPLACED_RECONNECT_MS)
        up(transport.last)
        assertFalse(socket.replacedByOther)
    }

    @Test fun upgrade4426CallsUpdateAndBacksOff() {
        val c = started()
        up(c)
        c.listener.onClosed(4426, "upgrade")
        assertEquals(1, cb.upgrades)
        assertReconnectAfter(500)
    }

    @Test fun otherCodesReconnect() {
        for (code in listOf(1000, 1006, 1011, 1012)) {
            val c = if (transport.conns.isEmpty()) started() else transport.last
            up(c)
            c.listener.onClosed(code, "x")
            assertEquals(Phase.WAITING, socket.phase)
            assertTrue(cb.checks.isEmpty())
            assertReconnectAfter(500)
        }
    }

    @Test fun closeToken4401And4403RunTheCheck() {
        for (code in listOf(4401, 4403)) {
            val c = if (transport.conns.isEmpty()) started() else transport.last
            up(c)
            c.listener.onClosed(code, "x")
            assertEquals(Phase.CHECKING, socket.phase)
            val n = transport.conns.size
            worker.advance(60_000)
            assertEquals("no reconnect while checking", n, transport.conns.size)
            cb.checks.removeAt(0)(CloseCodes.Check.Keep("200"))
            assertReconnectAfter(500)
        }
    }

    @Test fun revokedStopsForGood() {
        val c = started()
        up(c)
        c.listener.onClosed(4403, "revoked")
        cb.checks.single()(CloseCodes.Check.Revoked("DEVICE_REVOKED"))
        assertEquals(listOf("DEVICE_REVOKED"), cb.revoked)
        assertEquals(Phase.STOPPED, socket.phase)
        val n = transport.conns.size
        worker.advance(600_000)
        socket.onNetworkAvailable()
        assertEquals(n, transport.conns.size)
    }

    @Test fun guestAndHostKeepTheTokenWithTheirText() {
        val c = started()
        up(c)
        c.listener.onClosed(4403, "guest")
        cb.checks.removeAt(0)(CloseCodes.Check.Guest)
        assertTrue(cb.revoked.isEmpty())
        assertEquals("Connect to the staff Wi-Fi", socket.state().statusText)
        assertReconnectAfter(500)
        transport.last.listener.onOpen()
        assertEquals("tok-1", JSONObject(transport.last.sent.single()).getString("device_token"))
        assertEquals("text stays until up", "Connect to the staff Wi-Fi", socket.state().statusText)
        transport.last.listener.onClosed(4403, "host")
        cb.checks.removeAt(0)(CloseCodes.Check.Host)
        assertEquals("Open the hub by its address", socket.state().statusText)
        assertReconnectAfter(1000)
        up(transport.last)
        assertEquals("Connected", socket.state().statusText)
    }

    @Test fun unreachableCheckReconnects() {
        val c = started()
        up(c)
        c.listener.onClosed(4401, "x")
        cb.checks.single()(CloseCodes.Check.Unreachable)
        assertTrue(cb.revoked.isEmpty())
        assertReconnectAfter(500)
    }

    @Test fun staleCheckResultAfterStopIsIgnored() {
        val c = started()
        up(c)
        c.listener.onClosed(4403, "x")
        socket.stop()
        cb.checks.single()(CloseCodes.Check.Revoked("DEVICE_REVOKED"))
        assertTrue(cb.revoked.isEmpty())
    }

    @Test fun noTokenMeansStoppedNotPaired() {
        socket.start(origin, null)
        assertTrue(transport.conns.isEmpty())
        assertEquals(Phase.STOPPED, socket.phase)
        assertEquals("Not paired", socket.state().statusText)
    }

    @Test fun newTokenRestartsTheSocket() {
        val c = started()
        up(c)
        socket.start(origin, "tok-1")
        assertEquals("same credentials: nothing", 1, transport.conns.size)
        socket.start(origin, "tok-2")
        assertTrue(c.cancelled)
        assertEquals(2, transport.conns.size)
    }

    @Test fun stopClosesWith1000() {
        val c = started()
        up(c)
        socket.stop()
        assertEquals(1000, c.closedWith)
        assertEquals(Phase.STOPPED, socket.phase)
        c.listener.onClosed(1000, "bye")
        worker.advance(60_000)
        assertEquals(1, transport.conns.size)
    }
}

/** The real OkHttp socket against MockWebServer's WebSocket support (test 12 / 13 end to end). */
class AlertSocketRealTest {
    private val server = MockWebServer()
    private val worker = ExecutorWorker("test-worker")
    private val transport = OkHttpTransport()

    @After fun tearDown() {
        worker.shutdown()
        transport.shutdown()
        try { server.shutdown() } catch (_: Exception) {}
    }

    private class Recorder : SocketCallbacks {
        val phases = LinkedBlockingQueue<Phase>()
        val frames = LinkedBlockingQueue<String>()
        val checks = LinkedBlockingQueue<Int>()
        val logs = CopyOnWriteArrayList<String>()
        override fun onState(state: SocketState) { phases.add(state.phase) }
        override fun onFrame(text: String, recvT: Long) { frames.add(text) }
        override fun checkToken(origin: String, token: String, done: (CloseCodes.Check) -> Unit) { checks.add(1); done(CloseCodes.Check.Keep("200")) }
        override fun onRevoked(reason: String) {}
        override fun onUpgradeRequired() {}
        override fun onNewSocket() {}
        override fun log(ev: String, fields: Map<String, Any?>) { logs.add(ev) }
        fun awaitPhase(p: Phase, s: Long = 5): Boolean {
            val end = System.currentTimeMillis() + s * 1000
            while (System.currentTimeMillis() < end) {
                val got = phases.poll(end - System.currentTimeMillis(), TimeUnit.MILLISECONDS) ?: return false
                if (got == p) return true
            }
            return false
        }
    }

    private fun origin() = "http://${server.hostName}:${server.port}"

    @Test fun authAlertsOpenReceiptAndHubClose() {
        val serverIn = LinkedBlockingQueue<String>()
        var serverWs: WebSocket? = null
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { serverWs = webSocket }
            override fun onMessage(webSocket: WebSocket, text: String) {
                serverIn.add(text)
                if (JSONObject(text).optString("type") == "auth") {
                    webSocket.send("""{"type":"alerts_open","alerts":[],"binding_route_until":null}""")
                }
            }
        }))
        server.start()
        val rec = Recorder()
        val socket = AlertSocket(worker, transport, rec)
        worker.post { socket.start(origin(), "tok-real") }

        val auth = JSONObject(serverIn.poll(5, TimeUnit.SECONDS)!!)
        assertEquals("tok-real", auth.getString("device_token"))
        assertFalse(auth.has("session_token"))
        assertEquals("/ws", server.takeRequest(1, TimeUnit.SECONDS)!!.path)
        assertTrue(rec.awaitPhase(Phase.UP))
        assertTrue(rec.frames.poll(5, TimeUnit.SECONDS)!!.contains("alerts_open"))

        worker.post { socket.send("""{"type":"receipt","alert_id":"A","kind":"delivered","step":0}""") }
        assertEquals("receipt", JSONObject(serverIn.poll(5, TimeUnit.SECONDS)!!).getString("type"))

        // the hub closes with 4409 → replaced, no immediate reconnect
        serverWs!!.close(4409, "replaced")
        assertTrue(rec.awaitPhase(Phase.REPLACED_WAIT))
        assertEquals(1, server.requestCount)
    }

    @Test fun hubClose4403RunsTheCheckAndReconnects() {
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) { webSocket.close(4403, "forbidden") }
        }))
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) { webSocket.send("""{"type":"alerts_open","alerts":[],"binding_route_until":null}""") }
        }))
        server.start()
        val rec = Recorder()
        val socket = AlertSocket(worker, transport, rec)
        worker.post { socket.start(origin(), "tok") }
        assertEquals(1, rec.checks.poll(5, TimeUnit.SECONDS))
        assertTrue(rec.awaitPhase(Phase.UP))
        assertEquals(2, server.requestCount)
    }

    @Test fun upgradeNeverAnsweredTimesOutAndReconnects() {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)) // TCP accepted, no upgrade (§3.3)
        server.start()
        val rec = Recorder()
        val socket = AlertSocket(worker, transport, rec)
        worker.post { socket.start(origin(), "tok") }
        assertTrue(rec.awaitPhase(Phase.WAITING, Spec.FIRST_FRAME_TIMEOUT_MS / 1000 + 5))
        assertTrue(rec.logs.contains("first_frame_timeout"))
    }
}
