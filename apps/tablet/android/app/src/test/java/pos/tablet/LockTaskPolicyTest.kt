package pos.tablet

import pos.tablet.LockTaskPolicy.Action.CLEAR_LOCK_TASK_PACKAGES
import pos.tablet.LockTaskPolicy.Action.CLEAR_PREFERRED_HOME
import pos.tablet.LockTaskPolicy.Action.DISABLE_HOME_ALIAS
import pos.tablet.LockTaskPolicy.Action.ENABLE_HOME_ALIAS
import pos.tablet.LockTaskPolicy.Action.GRANT_POST_NOTIFICATIONS
import pos.tablet.LockTaskPolicy.Action.SET_LOCK_TASK_FEATURES
import pos.tablet.LockTaskPolicy.Action.SET_LOCK_TASK_PACKAGES
import pos.tablet.LockTaskPolicy.Action.SET_PREFERRED_HOME
import pos.tablet.LockTaskPolicy.Action.START_LOCK_TASK
import pos.tablet.LockTaskPolicy.Action.STOP_LOCK_TASK
import pos.tablet.MainHealth.ActivityManagerModes.LOCKED
import pos.tablet.MainHealth.ActivityManagerModes.NONE
import pos.tablet.MainHealth.ActivityManagerModes.PINNED
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 05b M-17 (N-4, N-13, O-16, O-19; plan A15; the device half is manual test 20): the lock-task decision. */
class LockTaskPolicyTest {
    private fun d(owner: Boolean, lock: Boolean, state: Int = NONE, sdk: Int = 34, resumed: Boolean = true) =
        LockTaskPolicy.decide(deviceOwner = owner, lockTask = lock, lockTaskModeState = state, sdk = sdk, resumed = resumed)

    @Test fun notDeviceOwnerDoesNothing() {
        assertEquals(emptyList<LockTaskPolicy.Action>(), d(owner = false, lock = true))
        assertEquals(emptyList<LockTaskPolicy.Action>(), d(owner = false, lock = false))
        assertEquals(emptyList<LockTaskPolicy.Action>(), d(owner = false, lock = false, state = PINNED))
    }

    @Test fun everyoneOnDeviceOwnerLocksAsHome() {
        assertEquals(
            listOf(GRANT_POST_NOTIFICATIONS, SET_LOCK_TASK_PACKAGES, SET_LOCK_TASK_FEATURES, ENABLE_HOME_ALIAS, SET_PREFERRED_HOME, START_LOCK_TASK),
            d(owner = true, lock = true),
        )
    }

    @Test fun alreadyLockedIsNotStartedAgain() {
        val a = d(owner = true, lock = true, state = LOCKED)
        assertFalse(a.contains(START_LOCK_TASK))
        assertTrue(a.contains(SET_PREFERRED_HOME)) // config is re-asserted at every resume (idempotent)
    }

    @Test fun notResumedConfiguresButStartsAtTheNextResume() {
        val a = d(owner = true, lock = true, resumed = false)
        assertFalse(a.contains(START_LOCK_TASK))
        assertTrue(a.contains(SET_LOCK_TASK_PACKAGES))
    }

    @Test fun listedOnDeviceOwnerUnlocksAndClearsHome() {
        assertEquals(
            listOf(GRANT_POST_NOTIFICATIONS, STOP_LOCK_TASK, CLEAR_PREFERRED_HOME, DISABLE_HOME_ALIAS, CLEAR_LOCK_TASK_PACKAGES),
            d(owner = true, lock = false, state = LOCKED),
        )
    }

    @Test fun listedNotLockedSkipsStop() {
        val a = d(owner = true, lock = false, state = NONE)
        assertFalse(a.contains(STOP_LOCK_TASK))
        // the whitelist must go too, or lockTaskMode="if_whitelisted" re-locks at the next launch
        assertTrue(a.contains(CLEAR_LOCK_TASK_PACKAGES))
        assertTrue(a.contains(CLEAR_PREFERRED_HOME))
    }

    @Test fun userScreenPinningIsLeftAlone() {
        assertFalse(d(owner = true, lock = false, state = PINNED).contains(STOP_LOCK_TASK))
    }

    @Test fun sdkGates() {
        val p = d(owner = true, lock = true, sdk = 27)
        assertFalse(p.contains(SET_LOCK_TASK_FEATURES))   // API 28+
        assertFalse(p.contains(GRANT_POST_NOTIFICATIONS)) // API 33+
        assertTrue(d(owner = true, lock = true, sdk = 28).contains(SET_LOCK_TASK_FEATURES))
        assertFalse(d(owner = true, lock = true, sdk = 32).contains(GRANT_POST_NOTIFICATIONS))
        assertTrue(d(owner = true, lock = false, sdk = 33).contains(GRANT_POST_NOTIFICATIONS))
    }

    /** N-13: NOTIFICATIONS | HOME | GLOBAL_ACTIONS exactly; no KEYGUARD, no SYSTEM_INFO, no OVERVIEW. */
    @Test fun exactFeatureSet() {
        assertEquals(2 or 4 or 16, LockTaskPolicy.FEATURES)
    }
}
