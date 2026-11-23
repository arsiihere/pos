package pos.tablet

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 05b M-8 (one notification per alert when signed in), M-21 / N-1 (unknown → hold); tests 15 (restart), 21, 22. */
class ShownHoldTest {
    private val w = FakeWorker()
    private var page = PageState(signedIn = true, activityVisible = true)
    private val reported = HashSet<String>()
    private val posted = ArrayList<Pair<String, Boolean>>()
    private val dropped = ArrayList<String>()
    private val hold = ShownHold(
        w, { page }, { id, step -> reported.contains("$id:$step") },
        post = { i, s -> posted.add(i.key to s) },
        dropped = { i, _ -> dropped.add(i.key) },
    )

    private fun item(id: String = "A1", step: Int = 0) = AlertItem(
        id, step, "void_approval", "urgent", 1L, JSONObject(), null, false, null, "alert",
    )

    @Test fun signedOutPostsAtOnce() {
        page = PageState(signedIn = false, activityVisible = true)
        hold.submit(item(), true)
        assertEquals(listOf("A1:0" to true), posted)
    }

    @Test fun signedInReportWithinTheHoldDropsTheServicePost() {
        hold.submit(item(), true)
        assertTrue(posted.isEmpty())
        w.advance(900)
        hold.onReported("A1", 0)
        w.advance(5_000)
        assertTrue(posted.isEmpty())
        assertEquals(listOf("A1:0"), dropped)
    }

    @Test fun signedInNoReportPostsAfterTheHold() {
        hold.submit(item(), true)
        w.advance(Spec.REPORT_SHOWN_HOLD_MS - 1)
        assertTrue(posted.isEmpty())
        w.advance(1)
        assertEquals(listOf("A1:0" to true), posted)
        hold.onReported("A1", 0) // late report: already posted, nothing more
        assertTrue(dropped.isEmpty())
        assertEquals(1, posted.size)
    }

    @Test fun reportBeforeTheFrameDropsAtOnce() {
        reported.add("A1:0")
        hold.submit(item(), true)
        assertEquals(listOf("A1:0"), dropped)
        assertTrue(posted.isEmpty())
    }

    @Test fun reportForAnotherStepDoesNotDrop() {
        hold.submit(item(step = 1), true)
        hold.onReported("A1", 0)
        w.advance(Spec.REPORT_SHOWN_HOLD_MS)
        assertEquals(listOf("A1:1" to true), posted)
    }

    @Test fun unknownSessionAfterARestartHolds() { // N-1 / test 15 restart case: no double banner
        page = PageState(signedIn = null, activityVisible = null)
        hold.submit(item(), true)
        assertTrue(posted.isEmpty())
        hold.onReported("A1", 0)
        assertEquals(listOf("A1:0"), dropped)
    }

    @Test fun stoppedActivityPostsAtOnceEvenWithAReport() { // test 22: screen off → the service posts
        page = PageState(signedIn = true, activityVisible = false)
        reported.add("A1:0")
        hold.submit(item(), true)
        assertEquals(listOf("A1:0" to true), posted)
    }

    @Test fun activityStopDuringTheHoldFlushes() {
        hold.submit(item(), true)
        page = PageState(signedIn = true, activityVisible = false)
        hold.onPageState()
        assertEquals(listOf("A1:0" to true), posted)
        w.advance(5_000)
        assertEquals(1, posted.size)
        assertEquals(0, hold.heldCount)
    }

    @Test fun silentPostsAreHeldToo() {
        hold.submit(item(), false)
        w.advance(Spec.REPORT_SHOWN_HOLD_MS)
        assertEquals(listOf("A1:0" to false), posted)
    }

    @Test fun ruleTable() {
        assertEquals(HoldAction.HOLD, ShownRule.decide(PageState(true, true), false))
        assertEquals(HoldAction.HOLD, ShownRule.decide(PageState(null, null), false))
        assertEquals(HoldAction.DROP, ShownRule.decide(PageState(null, true), true))
        assertEquals(HoldAction.POST_NOW, ShownRule.decide(PageState(false, true), false))
        assertEquals(HoldAction.POST_NOW, ShownRule.decide(PageState(true, false), true))
    }
}
