package pos.tablet

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** 05b M-16 (incl. N-7) probe table, M-1 origin-only normalising, N-3 timeout; plan A2; manual test 18 input. */
class HubProbeTest {
    private lateinit var server: MockWebServer
    private lateinit var origin: String

    @Before fun setUp() {
        server = MockWebServer()
        server.start()
        origin = "${server.hostName}:${server.port}"
    }

    @After fun tearDown() {
        try { server.shutdown() } catch (_: Exception) {}
    }

    private fun answer(code: Int, body: String) =
        server.enqueue(MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body))

    private val readyBody = """{"data":{"status":"ready","boot_step":"done","provisioned":true,"confirmed":true,
        |"branch_id":"b1","max_seq":3,"hub_version":"0.0.0","clock_alarm":null}}""".trimMargin()

    @Test fun readyProvisionedHubIsOk() {
        answer(200, readyBody)
        val r = HubProbe.probe(origin)
        assertEquals(ProbeResult(true, "ok", null), r)
        val req = server.takeRequest()
        assertEquals("/health", req.path)
        assertEquals("GET", req.method)
        assertEquals(BuildConfig.VERSION_NAME, req.getHeader("X-Client-Version"))
    }

    @Test fun guestAnswerWithOnlyStatusSaysStaffWifi() {
        answer(200, """{"data":{"status":"ready"}}""")
        val r = HubProbe.probe(origin)
        assertFalse(r.ok)
        assertEquals("guest", r.reason)
        assertEquals("Connect to the staff Wi-Fi", r.message)
    }

    @Test fun other200WithoutHubVersionIsNotPos() {
        answer(200, """{"data":{"status":"ok","uptime":5}}""")
        assertEquals("not_pos", HubProbe.probe(origin).reason)
        answer(200, """<html>router</html>""")
        assertEquals("not_pos", HubProbe.probe(origin).reason)
        answer(200, """{"status":"ready"}""")
        val r = HubProbe.probe(origin)
        assertEquals("not_pos", r.reason)
        assertEquals("Not a POS hub", r.message)
    }

    @Test fun hostNotAllowedErrorCode() {
        answer(421, """{"error":{"code":"HOST_NOT_ALLOWED","message":"x","details":{},"request_id":"1"}}""")
        val r = HubProbe.probe(origin)
        assertEquals("host_not_allowed", r.reason)
        assertEquals("Use the address shown on the hub's setup page (with the port)", r.message)
        answer(403, """{"error":{"code":"HOST_NOT_ALLOWED"}}""")
        assertEquals("host_not_allowed", HubProbe.probe(origin).reason)
    }

    @Test fun otherErrorStatusIsNotPos() {
        answer(404, "not found")
        assertEquals("not_pos", HubProbe.probe(origin).reason)
        answer(500, """{"error":{"code":"INTERNAL_ERROR"}}""")
        assertEquals("not_pos", HubProbe.probe(origin).reason)
    }

    @Test fun bootingOrSetupOrUnprovisionedIsStarting() {
        answer(200, readyBody.replace("\"ready\"", "\"booting\""))
        assertEquals("starting", HubProbe.probe(origin).reason)
        answer(200, readyBody.replace("\"ready\"", "\"setup\""))
        assertEquals("starting", HubProbe.probe(origin).reason)
        answer(200, readyBody.replace("\"provisioned\":true", "\"provisioned\":false"))
        val r = HubProbe.probe(origin)
        assertEquals("starting", r.reason)
        assertEquals("The hub is starting…", r.message)
    }

    @Test fun refusedConnectionIsNoHub() {
        val port = server.port
        server.shutdown()
        val r = HubProbe.probe("127.0.0.1:$port")
        assertEquals(ProbeResult(false, "no_hub", "No hub at this address"), r)
    }

    @Test fun silentServerTimesOutAsNoHub() {
        // The spike finding: a stopping hub can accept TCP and never answer (M-4). The probe must give up (N-3).
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val r = HubProbe.probe(origin, 300)
        assertEquals("no_hub", r.reason)
    }

    @Test fun badAddressNeverCallsTheNetwork() {
        val r = HubProbe.probe("192.168.1.10")
        assertEquals("bad_address", r.reason)
        assertTrue(r.message!!.contains("192.168.1.10:3000"))
        assertEquals(0, server.requestCount)
    }

    @Test fun timeoutIsTheSpecConstant() = assertEquals(3_000L, Spec.PROBE_TIMEOUT_MS)

    @Test fun normaliseOriginAcceptsHostPort() {
        assertEquals("http://192.168.1.10:3000", HubProbe.normaliseOrigin("192.168.1.10:3000"))
        assertEquals("http://192.168.1.10:3000", HubProbe.normaliseOrigin("  192.168.1.10:3000  "))
        assertEquals("http://192.168.1.10:3000", HubProbe.normaliseOrigin("http://192.168.1.10:3000/"))
        assertEquals("http://192.168.1.10:3000", HubProbe.normaliseOrigin("HTTP://192.168.1.10:3000"))
        assertEquals("http://hub.local:8080", HubProbe.normaliseOrigin("Hub.Local:8080"))
    }

    @Test fun normaliseOriginRejectsTheRest() {
        listOf(
            "", "   ", "192.168.1.10", "192.168.1.10:", ":3000", "192.168.1.10:0", "192.168.1.10:65536",
            "192.168.1.10:abc", "https://192.168.1.10:3000", "ws://192.168.1.10:3000",
            "192.168.1.10:3000/staff/", "192.168.1.10:3000?x=1", "192.168.1.10:3000#a", "user@192.168.1.10:3000",
            "192.168.1.256:3000", "192.168.1:3000", "[::1]:3000", "a b:3000", "-hub:3000", "hub_x:3000",
        ).forEach { assertNull("should reject '$it'", HubProbe.normaliseOrigin(it)) }
    }
}
