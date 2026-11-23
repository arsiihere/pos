package pos.tablet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 05b M-6 pure parts (the device proof is manual S5 / S6). */
class WatchdogTest {
    @Test fun exactWhenAllowedElseFallback() {
        assertEquals(WatchdogPlan.Mode.EXACT, WatchdogPlan.mode(24, false)) // below 31 exact needs no grant
        assertEquals(WatchdogPlan.Mode.EXACT, WatchdogPlan.mode(30, false))
        assertEquals(WatchdogPlan.Mode.EXACT, WatchdogPlan.mode(31, true))
        assertEquals(WatchdogPlan.Mode.EXACT, WatchdogPlan.mode(35, true))
        assertEquals(WatchdogPlan.Mode.INEXACT, WatchdogPlan.mode(31, false))
        assertEquals(WatchdogPlan.Mode.INEXACT, WatchdogPlan.mode(34, false))
    }

    @Test fun tick() {
        assertEquals(WatchdogPlan.Tick.STOP, WatchdogPlan.onTick(wantRunning = false, serviceRunning = false))
        assertEquals(WatchdogPlan.Tick.STOP, WatchdogPlan.onTick(wantRunning = false, serviceRunning = true))
        assertEquals(WatchdogPlan.Tick.RESTART, WatchdogPlan.onTick(wantRunning = true, serviceRunning = false))
        assertEquals(WatchdogPlan.Tick.CHECK, WatchdogPlan.onTick(wantRunning = true, serviceRunning = true))
    }

    @Test fun bootArmsIn60sAndStarts() {
        val b = WatchdogPlan.onBroadcast("android.intent.action.BOOT_COMPLETED", true)
        assertEquals(Spec.BOOT_WATCHDOG_MS, b.armInMs)
        assertEquals(60_000L, b.armInMs)
        assertTrue(b.startService)
    }

    @Test fun packageReplacedArmsAndStarts() {
        val b = WatchdogPlan.onBroadcast("android.intent.action.MY_PACKAGE_REPLACED", true)
        assertEquals(Spec.WATCHDOG_MS, b.armInMs)
        assertTrue(b.startService)
    }

    @Test fun nothingWhenNotWanted() {
        for (a in listOf("android.intent.action.BOOT_COMPLETED", "android.intent.action.MY_PACKAGE_REPLACED")) {
            val b = WatchdogPlan.onBroadcast(a, false)
            assertNull(b.armInMs)
            assertFalse(b.startService)
        }
    }

    @Test fun exportedReceiverIgnoresOtherActions() {
        for (a in listOf(null, "", "pos.tablet.WATCHDOG", "android.intent.action.PACKAGE_REPLACED", "evil")) {
            val b = WatchdogPlan.onBroadcast(a, true)
            assertNull(b.armInMs)
            assertFalse(b.startService)
        }
    }

    @Test fun specIntervals() {
        assertEquals(600_000L, Spec.WATCHDOG_MS)
        assertEquals(2_000L, Spec.TASK_REMOVED_WATCHDOG_MS)
    }
}
