package pos.tablet

import org.junit.Assert.assertEquals
import org.junit.Test

/** Sanity: the spec constants the lanes rely on (05b M-4, M-7, M-14). */
class ContractTest {
    @Test fun backoffIsHalfSecondToFiveSeconds() {
        assertEquals(listOf(500L, 1000L, 2000L, 4000L, 5000L), Spec.BACKOFF_MS.toList())
    }
    @Test fun nativeApiStartsAtOne() = assertEquals(1, Spec.NATIVE_API)
    @Test fun dedupeKeeps2000() = assertEquals(2000, Spec.DEDUPE_KEYS)
}
