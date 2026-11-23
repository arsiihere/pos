package pos.tablet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 05b test 14 (parsing part): the alert-mode frames of packages/events/src/ws.ts. */
class FramesTest {
    private val lock = """{"kind_label_key":"alerts.kind.kitchen_call","table_code":"T4","point_code":null,"requester_name":null}"""
    private fun row(id: String, extra: String = "") =
        """{"alert_id":"$id","kind":"kitchen_call","family":"urgent","step":1,"escalation":false,"set":"primary","for_staff_id":null,"lock":$lock,"raised_at":1700000000000$extra}"""

    @Test fun alertsOpenRowsAndBindingRoute() {
        val f = Frames.parse(
            """{"type":"alerts_open","alerts":[${row("A", ",\"seen_by_me\":true")},${row("B", ",\"seen_by_me\":false,\"from_business_day\":\"2026-11-22\"")},${row("C", ",\"from_business_day\":null")}],"binding_route_until":1700000600000}""",
        ) as Frame.AlertsOpen
        assertEquals(1_700_000_600_000L, f.bindingRouteUntil)
        assertEquals(listOf("A", "B", "C"), f.rows.map { it.alertId })
        val (a, b, c) = f.rows
        assertTrue(a.seenByMe)
        assertNull(a.fromBusinessDay)
        assertFalse(b.seenByMe)
        assertEquals("2026-11-22", b.fromBusinessDay)
        assertNull(c.fromBusinessDay)
        assertFalse("absent seen_by_me = false", c.seenByMe)
        assertEquals(1, a.step)
        assertEquals("urgent", a.family)
        assertEquals("kitchen_call", a.kind)
        assertEquals(1_700_000_000_000L, a.raisedAt)
        assertEquals("alerts.kind.kitchen_call", a.lock.getString("kind_label_key"))
        assertEquals("alerts_open", a.via)
        assertEquals("A:1", a.key)
    }

    @Test fun alertsOpenNullBindingAndBadRowsSkipped() {
        val f = Frames.parse(
            """{"type":"alerts_open","alerts":[${row("A")},{"alert_id":"X"},{"alert_id":"Y","kind":"k","family":"info","step":-1,"lock":{}},7],"binding_route_until":null}""",
        ) as Frame.AlertsOpen
        assertNull(f.bindingRouteUntil)
        assertEquals(listOf("A"), f.rows.map { it.alertId })
        assertEquals(3, f.badRows)
    }

    @Test fun alertFrame() {
        val f = Frames.parse("""{"type":"alert","alert":${row("A", ",\"outcome\":null,\"target\":null")}}""") as Frame.Alert
        assertEquals("A", f.item.alertId)
        assertEquals("alert", f.item.via)
        assertNull(f.item.outcome)
        assertFalse(f.item.seenByMe)
    }

    @Test fun requestResultOutcomeReachesTheLockText() {
        val f = Frames.parse(
            """{"type":"alert","alert":{"alert_id":"R","kind":"request_result","family":"info","step":0,"escalation":false,"set":"primary","for_staff_id":"S","lock":{"kind_label_key":"k"},"raised_at":1,"outcome":"approved"}}""",
        ) as Frame.Alert
        assertEquals("approved", f.item.outcome)
        assertEquals("approved", f.item.lockForText().getString("outcome"))
        assertFalse("the parsed lock is not changed", f.item.lock.has("outcome"))
    }

    @Test fun seenAndClosed() {
        assertEquals(Frame.Seen("A"), Frames.parse("""{"type":"alert_seen","alert_id":"A"}"""))
        assertEquals(Frame.Closed("B"), Frames.parse("""{"type":"alert_closed","alert_id":"B","reason":"answered","decision":"approve","by_name":"Imran"}"""))
        assertTrue(Frames.parse("""{"type":"alert_seen"}""") is Frame.Ignored)
    }

    @Test fun bindingRoute() {
        assertEquals(Frame.BindingRoute(5L), Frames.parse("""{"type":"binding_route","until":5}"""))
        assertEquals(Frame.BindingRoute(null), Frames.parse("""{"type":"binding_route","until":null}"""))
    }

    @Test fun unknownAndBrokenFramesAreIgnored() {
        assertEquals("unknown_type", (Frames.parse("""{"type":"event","seq":3}""") as Frame.Ignored).why)
        assertEquals("not_json", (Frames.parse("nope") as Frame.Ignored).why)
        assertTrue(Frames.parse("""{"type":"alert"}""") is Frame.Ignored)
        assertTrue(Frames.parse("""{"type":"alert","alert":{"alert_id":"A"}}""") is Frame.Ignored)
        assertTrue(Frames.parse("""{"type":"alerts_open"}""") is Frame.Ignored)
        assertTrue(Frames.parse("[]") is Frame.Ignored)
    }
}
