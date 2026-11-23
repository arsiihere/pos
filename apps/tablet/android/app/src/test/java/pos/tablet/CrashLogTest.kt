package pos.tablet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CrashLogTest {
    @Test fun reportCarriesMetaAndTheCauseChain() {
        val e = IllegalStateException("outer", IllegalArgumentException("inner cause"))
        val r = CrashLog.format(e, 123L, "pk.arifchatkhara.pos:alerts", "main", "0.1.9-main", 30, "TCL 9198S")
        assertTrue(r.contains("process=pk.arifchatkhara.pos:alerts thread=main"))
        assertTrue(r.contains("app=0.1.9-main sdk=30 device=TCL 9198S"))
        assertTrue(r.contains("java.lang.IllegalStateException: outer"))
        assertTrue(r.contains("Caused by: java.lang.IllegalArgumentException: inner cause"))
    }

    @Test fun processNameIsSafeAsAFileName() {
        assertEquals("pk.arifchatkhara.pos_alerts", CrashLog.safe("pk.arifchatkhara.pos:alerts"))
    }
}
