package pos.tablet

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

/** 05b test 13: the §3.5 close-code rule (O-13) and its HTTP check. */
class CloseCodesTest {
    private val server = MockWebServer()

    @After fun tearDown() { try { server.shutdown() } catch (_: Exception) {} }

    @Test fun decisionPerCode() {
        assertEquals(CloseCodes.Action.CHECK_TOKEN, CloseCodes.decide(4401))
        assertEquals(CloseCodes.Action.CHECK_TOKEN, CloseCodes.decide(4403))
        assertEquals(CloseCodes.Action.REPLACED, CloseCodes.decide(4409))
        assertEquals(CloseCodes.Action.UPGRADE_REQUIRED, CloseCodes.decide(4426))
        for (c in listOf(1000, 1001, 1006, 1011, 1012, 4000, 4404)) assertEquals(CloseCodes.Action.RECONNECT, CloseCodes.decide(c))
    }

    @Test fun classifyHubAnswers() {
        assertTrue(CloseCodes.classify(401, "DEVICE_TOKEN_INVALID") is CloseCodes.Check.Revoked)
        assertTrue(CloseCodes.classify(403, "DEVICE_REVOKED") is CloseCodes.Check.Revoked)
        assertTrue(CloseCodes.classify(403, "GUEST_NETWORK_FORBIDDEN") === CloseCodes.Check.Guest)
        assertTrue(CloseCodes.classify(403, "HOST_NOT_ALLOWED") === CloseCodes.Check.Host)
        // anything else keeps the token
        assertTrue(CloseCodes.classify(200, null) is CloseCodes.Check.Keep)
        assertTrue(CloseCodes.classify(404, "ROUTE_NOT_FOUND") is CloseCodes.Check.Keep)
        assertTrue(CloseCodes.classify(403, "DEVICE_TYPE_NOT_ALLOWED") is CloseCodes.Check.Keep)
        assertTrue(CloseCodes.classify(426, "CLIENT_UPGRADE_REQUIRED") is CloseCodes.Check.Keep)
        assertTrue(CloseCodes.classify(500, "INTERNAL_ERROR") is CloseCodes.Check.Keep)
        // a code with the wrong status is not a revoke
        assertTrue(CloseCodes.classify(403, "DEVICE_TOKEN_INVALID") is CloseCodes.Check.Keep)
        assertTrue(CloseCodes.classify(401, "DEVICE_REVOKED") is CloseCodes.Check.Keep)
        assertTrue(CloseCodes.classify(401, null) is CloseCodes.Check.Keep)
    }

    @Test fun statusTexts() {
        assertEquals("Connect to the staff Wi-Fi", CloseCodes.statusText(CloseCodes.Check.Guest))
        assertEquals("Open the hub by its address", CloseCodes.statusText(CloseCodes.Check.Host))
        assertNull(CloseCodes.statusText(CloseCodes.Check.Unreachable))
    }

    @Test fun errorEnvelope() {
        assertEquals("DEVICE_REVOKED", CloseCodes.errorCode("""{"error":{"code":"DEVICE_REVOKED","message":"x","details":{},"request_id":"r"}}"""))
        assertNull(CloseCodes.errorCode("""{"data":{"version_code":3}}"""))
        assertNull(CloseCodes.errorCode("not json"))
        assertNull(CloseCodes.errorCode(null))
    }

    private fun err(status: Int, code: String) =
        MockResponse().setResponseCode(status).setHeader("content-type", "application/json")
            .setBody("""{"error":{"code":"$code","message":"$code","details":{},"request_id":"r1"}}""")

    private fun check(): CloseCodes.Check = TokenCheck("0.1.7-test").check("http://${server.hostName}:${server.port}/", "tok-9")

    @Test fun httpCheckSendsTokenAndVersionToLatest() {
        server.enqueue(MockResponse().setBody("""{"data":{"version_code":3}}"""))
        server.start()
        assertTrue(check() is CloseCodes.Check.Keep)
        val req = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("GET", req.method)
        assertEquals("/app/android/latest", req.path)
        assertEquals("Bearer tok-9", req.getHeader("Authorization"))
        assertEquals("0.1.7-test", req.getHeader("X-Client-Version"))
    }

    @Test fun httpCheckRevokedAnswers() {
        server.enqueue(err(401, "DEVICE_TOKEN_INVALID"))
        server.enqueue(err(403, "DEVICE_REVOKED"))
        server.start()
        assertEquals("DEVICE_TOKEN_INVALID", (check() as CloseCodes.Check.Revoked).reason)
        assertEquals("DEVICE_REVOKED", (check() as CloseCodes.Check.Revoked).reason)
    }

    @Test fun httpCheckGuestHostAndOthersKeep() {
        server.enqueue(err(403, "GUEST_NETWORK_FORBIDDEN"))
        server.enqueue(err(403, "HOST_NOT_ALLOWED"))
        server.enqueue(err(404, "ROUTE_NOT_FOUND"))
        server.enqueue(err(403, "DEVICE_TYPE_NOT_ALLOWED"))
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>bad gateway</html>"))
        server.start()
        assertTrue(check() === CloseCodes.Check.Guest)
        assertTrue(check() === CloseCodes.Check.Host)
        assertEquals("ROUTE_NOT_FOUND", (check() as CloseCodes.Check.Keep).reason)
        assertEquals("DEVICE_TYPE_NOT_ALLOWED", (check() as CloseCodes.Check.Keep).reason)
        assertEquals("502", (check() as CloseCodes.Check.Keep).reason)
    }

    @Test fun httpCheckNoAnswerIsUnreachable() {
        server.start()
        val origin = "http://${server.hostName}:${server.port}"
        server.shutdown()
        assertTrue(TokenCheck("v").check(origin, "t") === CloseCodes.Check.Unreachable)
        assertTrue(TokenCheck("v").check("not a url", "t") === CloseCodes.Check.Unreachable)
    }
}
