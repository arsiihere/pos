package pos.tablet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** 05b M-1 start-page choice (origin-only server url + startPath), N-2 main-frame rule inputs; manual 18, 24. */
class StartPageTest {
    private val ok: (String) -> ProbeResult = { ProbeResult(true, "ok", null) }

    @Test fun noStoredOriginIsTheBundledFirstRunPage() {
        val c = StartPage.choose(null, null) { fail("must not probe"); ok(it) }
        assertEquals(StartChoice(null, "/index.html"), c)
    }

    @Test fun corruptStoredOriginIsFirstRun() {
        assertEquals(StartChoice(null, "/index.html"), StartPage.choose("garbage", null, ok))
    }

    @Test fun probeOkLoadsTheHubWithOriginOnlyAndStaffPath() {
        var probed: String? = null
        val c = StartPage.choose("http://192.168.1.10:3000", null) { probed = it; ok(it) }
        assertEquals("http://192.168.1.10:3000", probed)
        assertEquals(StartChoice("http://192.168.1.10:3000", "/staff/"), c)
        assertFalse(c.serverUrl!!.removePrefix("http://").contains('/'))
    }

    @Test fun probeFailureIsTheBundledUnreachablePageWithOriginAndReason() {
        val c = StartPage.choose("http://192.168.1.10:3000", null) { ProbeResult(false, "no_hub", "No hub at this address") }
        assertEquals(null, c.serverUrl)
        assertEquals("/unreachable.html?origin=http%3A%2F%2F192.168.1.10%3A3000&reason=no_hub", c.startPath)
    }

    @Test fun probeThatThrowsIsNoHub() {
        val c = StartPage.choose("http://192.168.1.10:3000", null) { throw IllegalStateException() }
        assertTrue(c.startPath.endsWith("reason=no_hub"))
    }

    @Test fun forcedMainFrameFailureSkipsTheProbe() {
        val c = StartPage.choose("http://192.168.1.10:3000", "starting") { fail("must not probe"); ok(it) }
        assertEquals(null, c.serverUrl)
        assertTrue(c.startPath.startsWith("/unreachable.html?origin="))
        assertTrue(c.startPath.endsWith("&reason=starting"))
    }

    @Test fun sameOriginComparesSchemeHostPort() {
        val o = "http://192.168.1.10:3000"
        assertTrue(StartPage.sameOrigin("http://192.168.1.10:3000/staff/#/inbox", o))
        assertTrue(StartPage.sameOrigin("http://192.168.1.10:3000/pair?hint=tablet", o))
        assertFalse(StartPage.sameOrigin("http://192.168.1.10:3001/staff/", o))
        assertFalse(StartPage.sameOrigin("https://192.168.1.10:3000/staff/", o))
        assertFalse(StartPage.sameOrigin("https://localhost/unreachable.html", o))
        assertFalse(StartPage.sameOrigin("http://192.168.1.10:3000/", null))
        assertTrue(StartPage.sameOrigin("http://hub/x", "http://hub:80"))
    }

    @Test fun mainFrameFailureReasons() {
        assertEquals("no_hub", StartPage.mainFrameFailureReason(0))
        assertEquals("starting", StartPage.mainFrameFailureReason(503))
        assertEquals("not_pos", StartPage.mainFrameFailureReason(404))
    }
}
