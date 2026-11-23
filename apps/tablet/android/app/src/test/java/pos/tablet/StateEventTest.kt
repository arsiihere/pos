package pos.tablet

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 05b §4.2 `state` event, N-1: `service_started` → the last state plus `needs_context: true`; M-14 `info()`. */
class StateEventTest {
    @Test fun serviceStartedKeepsLastState() {
        val last = JSONObject("""{"paired":true,"alert_socket":"up","binding_route_until":null,"update_ready":false,"needs_context":false}""")
        val e = StateEvent.serviceStarted(last)
        assertTrue(e.getBoolean("needs_context"))
        assertTrue(e.getBoolean("paired"))
        assertEquals("up", e.getString("alert_socket"))
        assertFalse("last state not mutated", last.getBoolean("needs_context"))
    }

    @Test fun serviceStartedWithoutState() {
        val e = StateEvent.serviceStarted(null)
        assertTrue(e.getBoolean("needs_context"))
        assertEquals(1, e.length())
    }

    @Test fun infoBody() {
        val j = MainHealth.info(42, "0.1.42", true)
        assertEquals(Spec.NATIVE_API, j.getInt("native_api"))
        assertEquals(42, j.getInt("version_code"))
        assertEquals("0.1.42", j.getString("version_name"))
        assertTrue(j.getBoolean("device_owner"))
        assertEquals(4, j.length())
    }
}
