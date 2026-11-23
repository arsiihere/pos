package pos.tablet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 05b M-12 notification / FSI tap deep link (M-11); manual 21 (FSI), 23 (tap → focused card, still signed in). */
class DeepLinkTest {
    private val id = "01JD8X5Q2W3E4R5T6Y7V8J9K0P" // 26 Crockford chars
    private val hub = "http://192.168.1.10:3000"

    @Test fun acceptsACanonicalUlid() {
        assertEquals(26, id.length)
        assertTrue(DeepLink.isUlid(id))
        assertTrue(DeepLink.isUlid("7ZZZZZZZZZZZZZZZZZZZZZZZZZ"))
        assertEquals(id, DeepLink.alertId(id))
    }

    @Test fun rejectsAnythingElse() {
        for (bad in listOf(
            null, "", id.dropLast(1), id + "0", id.lowercase(),
            "8ZZZZZZZZZZZZZZZZZZZZZZZZZ", // > 128 bits
            id.dropLast(1) + "I", id.dropLast(1) + "L", id.dropLast(1) + "O", id.dropLast(1) + "U",
            "01JD8X5Q2W3E4R5T6Y7U8J9K0'", "'; alert(1); '012345678901", id + "\n", " $id",
        )) {
            assertFalse("$bad", DeepLink.isUlid(bad))
            assertNull(DeepLink.alertId(bad))
        }
    }

    @Test fun hashScriptAndStaffPath() {
        assertEquals("#/inbox?focus=alert:$id", DeepLink.hash(id))
        assertEquals("location.hash = '#/inbox?focus=alert:$id'", DeepLink.script(id))
        assertEquals("/staff/#/inbox?focus=alert:$id", DeepLink.staffPath(id))
        // the id is the only variable part: nothing in the script can end the JS string
        assertEquals(2, DeepLink.script("7ZZZZZZZZZZZZZZZZZZZZZZZZZ").count { it == '\'' })
    }

    @Test(expected = IllegalArgumentException::class) fun hashRefusesAnInvalidId() {
        DeepLink.hash("x'")
    }

    @Test fun hubStaffPageLoadedSetsTheHashWithoutReload() {
        val a = DeepLink.onTap(id, "$hub/staff/#/orders", hub)
        assertEquals(TapAction.SetHash("location.hash = '#/inbox?focus=alert:$id'"), a)
        assertEquals(TapAction.SetHash(DeepLink.script(id)), DeepLink.onTap(id, "$hub/staff/", hub))
    }

    @Test fun otherwiseLoadsWithTheHash() {
        val load = TapAction.LoadWithHash(id)
        assertEquals(load, DeepLink.onTap(id, null, hub)) // nothing loaded yet
        assertEquals(load, DeepLink.onTap(id, "https://localhost/unreachable.html?origin=x", null)) // bundled page
        assertEquals(load, DeepLink.onTap(id, "https://localhost/index.html", hub))
        assertEquals(load, DeepLink.onTap(id, "$hub/kds/", hub)) // not the staff page
        assertEquals(load, DeepLink.onTap(id, "http://192.168.1.11:3000/staff/", hub)) // another origin
        assertEquals(load, DeepLink.onTap(id, "$hub/staff/", null))
    }

    @Test fun startPathAppliesAPendingTapOnlyToTheStaffPage() {
        assertEquals("/staff/#/inbox?focus=alert:$id" to true, DeepLink.startPath("/staff/", id))
        assertEquals("/staff/" to false, DeepLink.startPath("/staff/", null))
        assertEquals("/staff/" to false, DeepLink.startPath("/staff/", "bad"))
        assertEquals("/index.html" to false, DeepLink.startPath("/index.html", id))
        val unreachable = StartPage.unreachablePath(hub, HubProbe.NO_HUB)
        assertEquals(unreachable to false, DeepLink.startPath(unreachable, id))
    }
}
