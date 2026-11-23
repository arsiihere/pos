package pos.tablet

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FakeRepeatSink : RepeatSink {
    val plays = ArrayList<Pair<Long, Float>>()
    val silentPosts = ArrayList<String>()
    val cancelled = ArrayList<String>()
    var clock: () -> Long = { 0L }
    override fun play(gain: Float) { plays.add(clock() to gain) }
    override fun postSilent(item: AlertItem) { silentPosts.add(item.key) }
    override fun cancelNotification(alertId: String) { cancelled.add(alertId) }
    override fun log(ev: String, fields: Map<String, Any?>) {}
}

/** 05b test 15: urgent repeat — M-10, O-15, O-18, N-1 (01d §8.3 G1-14). */
class UrgentRepeatTest {
    private var w = FakeWorker()
    private val store = MemPersisted()
    private val sink = FakeRepeatSink().also { s -> s.clock = { w.now } }
    private var alwaysOn = false
    private fun newRepeat() = UrgentRepeat(store, w, sink) { alwaysOn }

    /** The process dies (its timers with it) and starts again on the same store. */
    private fun restartProcess() {
        w = FakeWorker().also { it.now = w.now }
        r = newRepeat()
        r.restore()
    }
    private var r = newRepeat()

    private fun item(id: String = "A1", step: Int = 0, escalation: Boolean = false, seen: Boolean = false) = AlertItem(
        id, step, "void_approval", "urgent", 1L, JSONObject().put("kind_label_key", "k"), null, seen, null, "alert",
        escalation,
    )

    private fun playTimes() = sink.plays.map { it.first }

    @Test fun servicePostedRepeatsEvery10sUntilSeenThen2Min() {
        r.onServicePosted(item())
        w.advance(9_999)
        assertTrue(sink.plays.isEmpty()) // the step's own ring was the notification
        w.advance(1)
        w.advance(20_000)
        assertEquals(listOf(10_000L, 20_000L, 30_000L), playTimes())
        assertTrue(sink.plays.all { it.second == UrgentRepeat.BASE_GAIN })
        r.onSeen("A1")
        w.advance(119_999)
        assertEquals(3, sink.plays.size)
        w.advance(1)
        assertEquals(30_000L + 120_000L, playTimes().last())
        r.onClosed("A1")
        w.advance(1_000_000)
        assertEquals(4, sink.plays.size)
        assertFalse(r.openIds().contains("A1"))
    }

    @Test fun escalationBeforeSeenStepsUpOnceAndUsesTheReminder() {
        r.onServicePosted(item(step = 0))
        w.advance(10_000)
        r.onServicePosted(item(step = 2, escalation = true))
        w.advance(119_999)
        assertEquals(1, sink.plays.size)
        w.advance(1)
        assertEquals(UrgentRepeat.STEP_UP_GAIN, sink.plays.last().second)
        r.onSeen("A1") // the step-up stays until closed
        w.advance(120_000)
        assertEquals(UrgentRepeat.STEP_UP_GAIN, sink.plays.last().second)
    }

    @Test fun escalationAfterSeenHasNoStepUp() {
        r.onServicePosted(item(step = 0))
        r.onSeen("A1")
        r.onServicePosted(item(step = 2, escalation = true))
        w.advance(120_000)
        assertEquals(listOf(120_000L to UrgentRepeat.BASE_GAIN), sink.plays)
    }

    @Test fun alwaysOnRingsOncePerStepOnly() {
        alwaysOn = true
        r.onServicePosted(item())
        w.advance(1_000_000)
        assertTrue(sink.plays.isEmpty())
    }

    @Test fun alwaysOnTurnedOnStopsAnArmedRepeat() {
        r.onServicePosted(item())
        alwaysOn = true
        w.advance(1_000_000)
        assertTrue(sink.plays.isEmpty())
    }

    @Test fun pageOwnedIsSilentInTheService() {
        r.onPageOwned(item())
        w.advance(1_000_000)
        assertTrue(sink.plays.isEmpty())
        assertEquals(RepeatOwner.PAGE, r.ownerOf("A1"))
    }

    @Test fun activityStopTakesOverWithin10sWithoutAFirstRingAndStartHandsBack() { // O-18
        r.onPageOwned(item())
        w.advance(3_000)
        r.onPageState(PageState(signedIn = true, activityVisible = false))
        assertEquals(listOf("A1:0"), sink.silentPosts) // the notification, without sound
        assertTrue(sink.plays.isEmpty())
        w.advance(10_000)
        assertEquals(listOf(13_000L), playTimes())
        r.onPageState(PageState(signedIn = true, activityVisible = true))
        assertEquals(RepeatOwner.PAGE, r.ownerOf("A1"))
        assertEquals(listOf("A1"), sink.cancelled)
        w.advance(1_000_000)
        assertEquals(1, sink.plays.size)
    }

    @Test fun seenPageOwnedIsNotTakenOver() {
        r.onPageOwned(item())
        r.onSeen("A1")
        r.onPageState(PageState(signedIn = true, activityVisible = false))
        assertTrue(sink.silentPosts.isEmpty())
        assertFalse(r.isArmed("A1"))
    }

    @Test fun signOutTakesOverButUnknownChangesNothing() {
        r.onPageOwned(item())
        r.onPageState(PageState(signedIn = null, activityVisible = null))
        assertEquals(RepeatOwner.PAGE, r.ownerOf("A1"))
        r.onPageState(PageState(signedIn = false, activityVisible = true))
        assertEquals(RepeatOwner.SERVICE, r.ownerOf("A1"))
        r.onPageState(PageState(signedIn = null, activityVisible = true)) // no hand-back while signed_in unknown
        assertEquals(RepeatOwner.SERVICE, r.ownerOf("A1"))
    }

    @Test fun serviceOwnedIsNotHandedBack() {
        r.onServicePosted(item())
        r.onPageState(PageState(signedIn = true, activityVisible = true))
        assertEquals(RepeatOwner.SERVICE, r.ownerOf("A1"))
        assertTrue(r.isArmed("A1"))
    }

    @Test fun pageReportingANewStepTakesItFromTheServiceAndRemovesTheServiceNotification() {
        r.onServicePosted(item(step = 0))
        r.onPageOwned(item(step = 1))
        assertEquals(listOf("A1"), sink.cancelled)
        w.advance(1_000_000)
        assertTrue(sink.plays.isEmpty())
    }

    @Test fun restartReArmsWithoutAFirstRing() { // M-10 persisted set
        r.onServicePosted(item("A1"))
        r.onPageOwned(item("B2"))
        r.onServicePosted(item("C3"))
        r.onSeen("C3")
        w.advance(5_000)
        restartProcess()
        assertTrue(sink.plays.size == 0)
        assertEquals(listOf("B2:0"), sink.silentPosts) // page-owned unseen: taken over (page state unknown, N-1)
        w.advance(10_000)
        assertEquals(listOf(15_000L, 15_000L), playTimes()) // A1 and B2; C3 is on the 2-min reminder
        w.advance(110_000)
        assertTrue(playTimes().contains(125_000L))
        r.onPageState(PageState(signedIn = true, activityVisible = true))
        assertEquals(RepeatOwner.PAGE, r.ownerOf("B2"))
        assertEquals(RepeatOwner.SERVICE, r.ownerOf("A1"))
    }

    @Test fun restoredItemKeepsItsFields() {
        r.onServicePosted(item(step = 3, escalation = true))
        restartProcess()
        w.advance(120_000)
        assertEquals(listOf(120_000L to UrgentRepeat.STEP_UP_GAIN), sink.plays)
    }

    @Test fun alertsOpenDropsClosedOnes() {
        r.onServicePosted(item("A1"))
        r.onServicePosted(item("B2"))
        r.retainOnly(setOf("B2"))
        assertEquals(setOf("B2"), r.openIds())
        w.advance(10_000)
        assertEquals(1, sink.plays.size)
    }

    @Test fun corruptStoreReadsEmpty() {
        store.value = "{not json"
        restartProcess()
        assertTrue(r.openIds().isEmpty())
    }

    @Test fun seenByMeRowStartsOnTheReminder() {
        r.onServicePosted(item(seen = true))
        w.advance(10_000)
        assertTrue(sink.plays.isEmpty())
        assertEquals(0, r.openUnseenCount())
    }
}
