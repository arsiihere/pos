package pos.tablet

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 05b M-4 / §3.5: replies matched by req_id; a timeout answers null once; a late reply is dropped. */
class PendingRepliesTest {
    private val timers = mutableListOf<Pair<Long, Runnable>>()
    private val p = PendingReplies { d, r -> timers += d to r }

    @Test fun replyBeforeTimeout() {
        val got = mutableListOf<JSONObject?>()
        p.add("a", 3_000, { got += it })
        assertEquals(3_000L, timers.single().first)
        assertTrue(p.complete("a", JSONObject("""{"revoked":true}""")))
        timers.single().second.run()
        assertEquals(1, got.size)
        assertTrue(got[0]!!.getBoolean("revoked"))
    }

    @Test fun timeoutThenLateReply() {
        val got = mutableListOf<JSONObject?>()
        p.add("a", 1_000, { got += it })
        timers.single().second.run()
        assertFalse(p.complete("a", JSONObject()))
        assertEquals(1, got.size)
        assertNull(got[0])
    }

    @Test fun unknownAndMissingReqId() {
        p.add("a", 1_000, { })
        assertFalse(p.complete("b", JSONObject()))
        assertFalse(p.complete(null, JSONObject()))
        assertEquals(1, p.size())
    }

    @Test fun failAll() {
        val got = mutableListOf<JSONObject?>()
        p.add("a", 1_000, { got += it }); p.add("b", 1_000, { got += it })
        p.failAll()
        assertEquals(listOf<JSONObject?>(null, null), got)
        assertEquals(0, p.size())
    }
}
