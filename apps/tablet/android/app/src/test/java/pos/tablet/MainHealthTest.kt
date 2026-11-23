package pos.tablet

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 05b M-18 (plan A16, Gradle "health mapping"): the shape of `health()`. */
class MainHealthTest {
    private fun snap(store: String? = null) = MainHealth.Snapshot(
        deviceOwner = true,
        lockTaskState = "locked",
        postNotifications = true,
        channels = mapOf(Channels.URGENT to MainHealth.Channel(4, "content://alarm"), Channels.INFO to null),
        fsiAllowed = true,
        batteryExempt = false,
        exactAlarms = true,
        canInstall = false,
        mainStoreError = store,
        versionName = "0.1.7",
    )

    @Test fun mainFields() {
        val j = MainHealth.toJson(snap())
        for (k in listOf("device_owner", "lock_task_state", "post_notifications", "channels", "fsi_allowed", "battery_exempt", "exact_alarms", "can_install", "main_store_error", "native_api", "version_name")) {
            assertTrue(k, j.has(k))
        }
        assertEquals(Spec.NATIVE_API, j.getInt("native_api"))
        assertEquals("locked", j.getString("lock_task_state"))
        assertTrue(j.isNull("main_store_error"))
        val urgent = j.getJSONObject("channels").getJSONObject(Channels.URGENT)
        assertEquals(4, urgent.getInt("importance"))
        assertEquals("content://alarm", urgent.getString("sound"))
        val info = j.getJSONObject("channels").getJSONObject(Channels.INFO)
        assertFalse(info.getBoolean("exists"))
        assertTrue(info.isNull("importance"))
        assertEquals("AEADBadTagException", MainHealth.toJson(snap("AEADBadTagException")).getString("main_store_error"))
    }

    @Test fun lockTaskStates() {
        assertEquals("none", MainHealth.lockTaskState(0))
        assertEquals("locked", MainHealth.lockTaskState(1))
        assertEquals("pinned", MainHealth.lockTaskState(2))
    }

    @Test fun noAlertsAnswerMeansServiceNotConnected() {
        val h = MainHealth.merge(MainHealth.toJson(snap()), null, null)
        assertFalse(h.getBoolean("service_connected"))
        for (k in MainHealth.ALERTS_KEYS - "service_connected") assertTrue(k, h.has(k) && h.isNull(k))
        assertTrue(h.isNull("paired"))
        assertTrue(h.getBoolean("device_owner"))
    }

    @Test fun alertsReplyMergedAndPairedFromLastState() {
        val alerts = JSONObject("""{"service_connected":true,"alert_socket":"up","last_frame_age_ms":1200,"wake_lock":true,"store_readable":true,"replaced_by_other":false,"device_owner":false}""")
        val h = MainHealth.merge(MainHealth.toJson(snap()), alerts, JSONObject("""{"paired":true}"""))
        assertTrue(h.getBoolean("service_connected"))
        assertEquals("up", h.getString("alert_socket"))
        assertEquals(1200, h.getInt("last_frame_age_ms"))
        assertTrue(h.getBoolean("wake_lock"))
        assertTrue(h.getBoolean("paired"))
        assertTrue("main owns its keys", h.getBoolean("device_owner"))
    }
}
