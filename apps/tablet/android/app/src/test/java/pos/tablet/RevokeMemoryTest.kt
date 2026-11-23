package pos.tablet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 05b O-20 (§3.5, N-5, N-9; v1.0.1): native's last-revoke record breaks the revoked-token re-offer loop. */
class RevokeMemoryTest {
    private fun memory(p: MemPersisted = MemPersisted()) = RevokeMemory(p) { 1_700_000_000_000 }

    @Test fun recordWrittenOnConfirmedRevokeWithHashNotToken() {
        for (reason in listOf("DEVICE_TOKEN_INVALID", "DEVICE_REVOKED")) {
            val p = MemPersisted()
            val m = memory(p)
            assertTrue(m.onRevoked("tok-secret", reason))
            val r = m.record()!!
            assertEquals(RevokeMemory.sha256Hex("tok-secret"), r.tokenSha256)
            assertEquals(64, r.tokenSha256.length)
            assertEquals(reason, r.reason)
            assertEquals(1_700_000_000_000, r.at)
            assertFalse(p.value!!.contains("tok-secret"))
        }
    }

    @Test fun noRecordOnHubAddressChangedOrWithoutToken() {
        val p = MemPersisted()
        val m = memory(p)
        assertFalse(m.onRevoked("tok", "hub_address_changed"))
        assertFalse(m.onRevoked(null, "DEVICE_REVOKED"))
        assertFalse(m.onRevoked("", "DEVICE_REVOKED"))
        assertNull(m.record())
        assertEquals(0, p.saves)
    }

    @Test fun aSecondRevokeWithoutTokenKeepsTheRecord() {
        val m = memory()
        m.onRevoked("tok", "DEVICE_TOKEN_INVALID")
        m.onRevoked(null, "DEVICE_REVOKED") // socket and confirmRevoked both saw it; native's copy already cleared
        assertEquals("DEVICE_TOKEN_INVALID", m.record()!!.reason)
    }

    @Test fun confirmRevokedWithoutTokenAnswersFromTheRecord() {
        val m = memory()
        val none = m.answerWithoutToken()
        assertFalse(none.getBoolean("revoked"))
        assertEquals("NO_NATIVE_TOKEN", none.getString("reason"))
        m.onRevoked("tok", "DEVICE_REVOKED")
        val a = m.answerWithoutToken()
        assertTrue(a.getBoolean("revoked"))
        assertEquals("DEVICE_REVOKED", a.getString("reason"))
    }

    @Test fun setDeviceTokenRefusesTheRevokedTokenOnly() {
        val m = memory()
        assertFalse(m.refuses("tok"))
        m.onRevoked("tok", "DEVICE_TOKEN_INVALID")
        assertTrue(m.refuses("tok"))
        assertFalse(m.refuses("tok-new"))
        assertEquals("TOKEN_REVOKED", RevokeMemory.TOKEN_REVOKED_CODE)
        assertEquals("This tablet was removed. Pair it again.", RevokeMemory.TOKEN_REVOKED_MESSAGE)
    }

    @Test fun aDifferentAcceptedTokenClearsTheRecord() {
        val p = MemPersisted()
        val m = memory(p)
        m.onRevoked("tok", "DEVICE_REVOKED")
        m.clear()
        assertNull(m.record())
        assertFalse(m.refuses("tok"))
        assertFalse(m.answerWithoutToken().getBoolean("revoked"))
        val saves = p.saves
        m.clear() // nothing to clear: no write
        assertEquals(saves, p.saves)
    }

    @Test fun anUnreadableRecordReadsAsNone() {
        val p = MemPersisted().apply { value = "not json" }
        assertNull(memory(p).record())
        assertFalse(memory(p).refuses("tok"))
    }
}
