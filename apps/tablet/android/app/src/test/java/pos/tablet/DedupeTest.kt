package pos.tablet

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MemPersisted : Persisted {
    var value: String? = null
    var saves = 0
    override fun load(): String? = value
    override fun save(value: String) { this.value = value; saves++ }
}

class FakeSink(private val silentKinds: Set<String> = setOf("approval_receipt")) : IntakeSink {
    /** Every side effect in order: "post:<key>:<sound>", "cancel:<id>", "send:<key>". */
    val events = ArrayList<String>()
    var accept = true
    var onSend: (() -> Unit)? = null
    override fun isSilentKind(item: AlertItem) = item.kind in silentKinds
    override fun post(item: AlertItem, withSound: Boolean) { events.add("post:${item.key}:${if (withSound) "sound" else "silent"}") }
    override fun cancel(alertId: String) { events.add("cancel:$alertId") }
    override fun send(text: String): Boolean {
        onSend?.invoke()
        val o = JSONObject(text)
        assertEquals("receipt", o.getString("type"))
        assertEquals("delivered", o.getString("kind"))
        events.add("send:${o.getString("alert_id")}:${o.getInt("step")}")
        return accept
    }
    override fun log(ev: String, fields: Map<String, Any?>) {}
    fun posts() = events.filter { it.startsWith("post:") }
    fun sends() = events.filter { it.startsWith("send:") }
}

fun item(
    id: String, step: Int = 0, family: String = "urgent", kind: String = "kitchen_call", via: String = "alert",
    seen: Boolean = false, fromDay: String? = null,
) = AlertItem(id, step, kind, family, 1_700_000_000_000, JSONObject().put("kind_label_key", "k.$kind"), null, seen, fromDay, via)

/** 05b test 11 (dedupe, receipts, seen_by_me silent) and the M-9 / D-4 silent rules of test 14. */
class DedupeTest {
    private val keys = MemPersisted()
    private val urgent = MemPersisted()
    private val sink = FakeSink()
    private fun intake(d: Dedupe = Dedupe(keys)) = AlertIntake(d, OpenUrgent(urgent), sink) { 42L }

    @Test fun keeps2000KeysAcrossARestart() {
        val d = Dedupe(keys)
        for (i in 0 until 2_100) d.add("A$i:0")
        d.flush()
        val again = Dedupe(keys)
        assertEquals(Spec.DEDUPE_KEYS, again.size)
        assertFalse("oldest dropped", again.contains("A0:0"))
        assertFalse(again.contains("A99:0"))
        assertTrue(again.contains("A100:0"))
        assertTrue(again.contains("A2099:0"))
    }

    @Test fun corruptStoreReadsEmpty() {
        keys.value = "{not an array"
        assertEquals(0, Dedupe(keys).size)
    }

    @Test fun newKeyPostsWithSoundThenReceipt() {
        val i = intake()
        assertEquals(listOf(Decision.POST_SOUND), i.onFrame(Frame.Alert(item("A"))))
        assertEquals(listOf("post:A:0:sound", "send:A:0"), sink.events)
    }

    @Test fun knownKeySendsReceiptAndPostsNothing() {
        intake().onFrame(Frame.Alert(item("A")))
        sink.events.clear()
        // after a restart (new intake, same store) the key is still known
        val i = intake()
        assertEquals(listOf(Decision.DUPLICATE), i.onFrame(Frame.AlertsOpen(listOf(item("A", via = "alerts_open")), null, 0)))
        assertEquals(listOf("send:A:0"), sink.events)
    }

    @Test fun newStepIsANewKey() {
        val i = intake()
        i.onFrame(Frame.Alert(item("A", 0)))
        assertEquals(listOf(Decision.POST_SOUND), i.onFrame(Frame.Alert(item("A", 1))))
        assertEquals(2, sink.posts().size)
    }

    @Test fun keyIsOnDiskBeforeTheReceipt() {
        val i = intake()
        var savedAtSend: String? = null
        sink.onSend = { savedAtSend = keys.value }
        i.onFrame(Frame.Alert(item("A")))
        assertTrue(savedAtSend!!.contains("A:0"))
    }

    @Test fun alertsOpenPersistsOnceThenReceiptsAfterAllPosts() {
        val i = intake()
        val rows = (1..5).map { item("R$it", via = "alerts_open") }
        i.onFrame(Frame.AlertsOpen(rows, null, 0))
        assertEquals(1, keys.saves)
        val firstSend = sink.events.indexOfFirst { it.startsWith("send:") }
        val lastPost = sink.events.indexOfLast { it.startsWith("post:") }
        assertTrue(lastPost < firstSend)
        assertEquals(5, sink.sends().size)
    }

    @Test fun seenByMeIsSilent() {
        assertEquals(listOf(Decision.POST_SILENT), intake().onFrame(Frame.AlertsOpen(listOf(item("A", via = "alerts_open", seen = true)), null, 0)))
        assertEquals(listOf("post:A:0:silent", "send:A:0"), sink.events)
    }

    @Test fun fromBusinessDayIsSilent() {
        assertEquals(listOf(Decision.POST_SILENT), intake().onFrame(Frame.AlertsOpen(listOf(item("A", via = "alerts_open", fromDay = "2026-11-22")), null, 0)))
        assertTrue(urgent.value == null || !JSONObject(urgent.value!!).has("A"))
    }

    @Test fun silentKindPostsNothingButReceipts() {
        assertEquals(listOf(Decision.SILENT_KIND), intake().onFrame(Frame.Alert(item("A", family = "info", kind = "approval_receipt"))))
        assertEquals(listOf("send:A:0"), sink.events)
    }

    @Test fun alertsOpenInfoRowIsNotReNotified() {
        // 01d §8.1: only urgent / action rows re-notify on reconnect; a live info alert rings
        val i = intake()
        assertEquals(
            listOf(Decision.POST_SOUND, Decision.POST_SOUND, Decision.POST_SILENT),
            i.onFrame(Frame.AlertsOpen(listOf(item("U", via = "alerts_open"), item("C", family = "action", via = "alerts_open"), item("I", family = "info", via = "alerts_open")), null, 0)),
        )
        assertEquals(listOf(Decision.POST_SOUND), i.onFrame(Frame.Alert(item("J", family = "info"))))
    }

    @Test fun receiptOncePerKeyPerSocket() {
        val i = intake()
        i.onFrame(Frame.Alert(item("A")))
        i.onFrame(Frame.Alert(item("A")))
        assertEquals(1, sink.sends().size)
        i.onNewSocket()
        i.onFrame(Frame.AlertsOpen(listOf(item("A", via = "alerts_open")), null, 0))
        assertEquals("a new socket receipts again (the hub dedupes)", 2, sink.sends().size)
    }

    @Test fun unqueuedReceiptIsRetriedOnTheNextArrival() {
        val i = intake()
        sink.accept = false
        i.onFrame(Frame.Alert(item("A")))
        sink.accept = true
        i.onFrame(Frame.Alert(item("A")))
        assertEquals(2, sink.sends().size)
        assertEquals(1, sink.posts().size)
    }

    @Test fun openUrgentSetFollowsSeenAndClosed() {
        val i = intake()
        i.onFrame(Frame.Alert(item("U1")))
        i.onFrame(Frame.Alert(item("U2", 1)))
        i.onFrame(Frame.Alert(item("C", family = "action")))
        assertEquals(mapOf("U1" to 0, "U2" to 1), i.openUrgent.snapshot())
        i.onFrame(Frame.Seen("U1"))
        assertEquals(setOf("U2"), i.openUrgent.snapshot().keys)
        i.onFrame(Frame.Closed("U2"))
        assertTrue(i.openUrgent.snapshot().isEmpty())
        assertTrue(sink.events.contains("cancel:U2"))
        // persisted: a restart sees the same (empty) set
        assertTrue(OpenUrgent(urgent).snapshot().isEmpty())
    }

    @Test fun openUrgentSurvivesARestart() {
        intake().onFrame(Frame.Alert(item("U1", 2)))
        assertEquals(mapOf("U1" to 2), OpenUrgent(urgent).snapshot())
    }

    @Test fun alertsOpenPrunesClosedAlerts() {
        val i = intake()
        i.onFrame(Frame.Alert(item("U1")))
        i.onFrame(Frame.Alert(item("U2")))
        sink.events.clear()
        i.onFrame(Frame.AlertsOpen(listOf(item("U2", via = "alerts_open")), null, 0))
        assertEquals(setOf("U2"), i.openUrgent.snapshot().keys)
        assertTrue(sink.events.contains("cancel:U1"))
    }

    @Test fun seenByMeRowLeavesTheOpenUrgentSet() {
        val i = intake()
        i.onFrame(Frame.Alert(item("U1")))
        i.onFrame(Frame.AlertsOpen(listOf(item("U1", 1, via = "alerts_open", seen = true)), null, 0))
        assertTrue(i.openUrgent.snapshot().isEmpty())
    }
}
