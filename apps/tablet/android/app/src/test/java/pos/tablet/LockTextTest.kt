package pos.tablet

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 05b test 14 (text part): lock text from the committed lock-strings.json in EN and UR; silent kinds; the
 * request_result outcome sounds (M-9). The expected lines are what the page's lock panel shows for the same views
 * (the Vitest gate checks the generator's renderer against labels.ts lockText for every key).
 */
class LockTextTest {
    private val strings: LockStrings = LockStrings(
        listOf("src/main/assets/lock-strings.json", "app/src/main/assets/lock-strings.json")
            .map(::File).first { it.isFile }.readText(Charsets.UTF_8),
    )

    private fun lock(vararg kv: Pair<String, Any?>): JSONObject =
        JSONObject().apply { kv.forEach { (k, v) -> put(k, v ?: JSONObject.NULL) } }

    private fun view(kind: String, family: String, outcome: String?, lock: JSONObject): JSONObject =
        JSONObject().put("alert_id", "A1").put("kind", kind).put("family", family)
            .put("outcome", outcome ?: JSONObject.NULL).put("lock", lock)

    private val void = lock("kind_label_key" to "alert.void_approval.lock", "table_code" to "12", "point_code" to null, "requester_name" to "Hamza")

    @Test fun `test 14 - EN and UR lock lines`() {
        assertEquals("T12 · Void · Hamza", strings.lineOf("void_approval", void, "en"))
        assertEquals("T12 · ووئڈ · Hamza", strings.lineOf("void_approval", void, "ur"))
        val ready = lock("kind_label_key" to "alert.ready_to_serve.lock", "table_code" to "Patio 3", "point_code" to "Pass", "requester_name" to "X")
        assertEquals("Ready to serve · Patio 3 · Pass", strings.lineOf("ready_to_serve", ready, "en"))
        assertEquals("پیش کرنے کو تیار · Patio 3 · Pass", strings.lineOf("ready_to_serve", ready, "ur"))
        val slip = lock("kind_label_key" to "alert.slip_warning.lock", "table_code" to "")
        assertEquals("Running late", strings.lineOf("slip_warning", slip, "en"))
        assertEquals("دیر ہو رہی ہے", strings.lineOf("slip_warning", slip, "ur"))
        val test = lock("kind_label_key" to "alert.test_alert.lock", "requester_name" to null)
        assertEquals("Test alert", strings.lineOf("test_alert", test, "en"))
        assertEquals("ٹیسٹ الرٹ", strings.lineOf("test_alert", test, "ur"))
        val pin = lock("kind_label_key" to "alert.pin_use_failed.lock", "device_name" to "Till 1")
        // no Urdu text yet: the English one (client i18n t())
        assertEquals("Your PIN was used on Till 1", strings.lineOf("pin_use_failed", pin, "ur"))
    }

    @Test fun `an unknown language reads English`() {
        assertEquals("T12 · Void · Hamza", strings.lineOf("void_approval", void, "fr"))
    }

    @Test fun `comp with no table reads Takeaway order`() {
        val comp = lock("kind_label_key" to "alert.comp.lock", "table_code" to null, "requester_name" to "Ali")
        assertEquals("Comp · Takeaway order", strings.lineOf("comp", comp, "en"))
    }

    @Test fun `request_result reads by the view's outcome (AD-82)`() {
        val l = lock("kind_label_key" to "alert.request_result.lock", "table_code" to "4")
        assertEquals("Request approved · T4", strings.lineOf("request_result", view("request_result", "info", "approved", l), "en"))
        assertEquals("Request rejected · T4", strings.lineOf("request_result", view("request_result", "info", "rejected", l), "en"))
        assertEquals("Request answered · T4", strings.lineOf("request_result", view("request_result", "info", null, l), "en"))
        // the bare lock carries no outcome
        assertEquals("Request answered · T4", strings.lineOf("request_result", l, "en"))
    }

    @Test fun `an unknown key reads the generic text by family, never the key, and is reported`() {
        val l = lock("kind_label_key" to "alert.mystery.lock", "table_code" to "7", "requester_name" to "Ali")
        val seen = mutableListOf<String>()
        assertEquals("T7 · Request · Ali", strings.lineOf("mystery", view("mystery", "urgent", null, l), "en") { seen += it })
        assertEquals("T7 · Alert · Ali", strings.lineOf("mystery", view("mystery", "info", null, l), "en") { seen += it })
        assertEquals(listOf("alert.mystery.lock", "alert.mystery.lock"), seen)
    }

    @Test fun `test 14 - silent kinds`() {
        assertTrue(strings.isSilent("approval_receipt"))
        assertFalse(strings.isSilent("void_approval"))
        assertEquals(LockStrings.NONE, strings.sound("approval_receipt", "info", null))
    }

    @Test fun `M-9 sound families and request_result outcome sounds`() {
        assertEquals("urgent", strings.sound("void_approval", "urgent", null))
        assertEquals("action", strings.sound("ready_to_serve", "action", null))
        assertEquals("info", strings.sound("call_waiter", "info", null))
        val l = lock("kind_label_key" to "alert.request_result.lock")
        assertEquals("result_approved", strings.soundOf("request_result", "info", view("request_result", "info", "approved", l)))
        assertEquals("result_rejected", strings.soundOf("request_result", "info", view("request_result", "info", "rejected", l)))
        assertEquals(LockStrings.NONE, strings.soundOf("request_result", "info", view("request_result", "info", "withdrawn", l)))
        assertEquals("info", strings.soundOf("request_result", "info", view("request_result", "info", "obsolete", l)))
        assertEquals("info", strings.soundOf("request_result", "info", l))
    }

    @Test fun `the asset is version 1`() {
        assertEquals(1, strings.version)
    }
}
