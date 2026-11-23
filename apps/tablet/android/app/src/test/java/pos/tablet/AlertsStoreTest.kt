package pos.tablet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.crypto.AEADBadTagException

/** 05b M-22 / plan A3: a token store that throws reads as "not paired", never a crash; a re-pair can write. */
class AlertsStoreTest {
    private class Box { val map = HashMap<String, String>(); var broken = false }

    @Test fun openThrowingReadsAsNotPaired() {
        val t = Tolerant<Box>({ throw AEADBadTagException("keyset") })
        assertNull(t.read(null) { it.map["device_token"] })
        assertFalse(t.readable)
        assertTrue(t.error!!.contains("AEADBadTagException"))
    }

    @Test fun readThrowingReadsAsDefault() {
        val box = Box().apply { broken = true }
        val t = Tolerant({ box })
        val v: String? = t.read(null) { if (it.broken) throw AEADBadTagException("value") else it.map["device_token"] }
        assertNull(v)
        assertFalse(t.readable)
    }

    @Test fun writeResetsAnUnopenableStoreOnceAndRetries() {
        var opens = 0
        var resets = 0
        val box = Box()
        val t = Tolerant({ opens++; if (resets == 0) throw AEADBadTagException("keyset") else box }, { resets++ })
        assertNull(t.read(null) { it.map["device_token"] })
        assertTrue(t.write { it.map["device_token"] = "tok" })
        assertEquals(1, resets)
        assertTrue(t.readable)
        assertEquals("tok", t.read(null) { it.map["device_token"] })
    }

    @Test fun writeFailsCleanlyWhenTheStoreStaysBroken() {
        val t = Tolerant<Box>({ throw AEADBadTagException("keystore gone") })
        assertFalse(t.write { it.map["x"] = "y" })
        assertFalse(t.readable)
    }
}
