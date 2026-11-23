package pos.tablet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 05b §10.2 test 17: each `PosNative` method from an allowed and a refused URL (§3.6, N-8); M-3; M-1 origin form. */
class GuardTest {
    private val hub = "http://192.168.1.10:8080"

    private val bundledUrls = listOf("https://localhost", "https://localhost/", "https://localhost/index.html#/x", "https://LOCALHOST:443/a?b=1")
    private val hubPairUrls = listOf("$hub/pair", "$hub/pair?hint=tablet", "$hub/pair#code", "http://192.168.1.10:8080/pair?x=1#y")
    private val hubOtherUrls = listOf("$hub/", "$hub", "$hub/staff/", "$hub/staff/#/inbox?focus=alert:01H", "$hub/admin/approve", "$hub/pair/", "$hub/pairx", "$hub/staff/pair")
    private val foreignUrls = listOf(
        null, "", "about:blank", "file:///android_asset/public/index.html", "data:text/html,hi",
        "http://localhost", "http://localhost/", "https://localhost:8443/", "https://localhost.evil.com/",
        "http://192.168.1.10:8081/pair", "https://192.168.1.10:8080/pair", "http://192.168.1.11:8080/pair",
        "http://192.168.1.10/pair", "http://user@192.168.1.10:8080/pair", "http://evil.com/pair", "not a url",
    )

    private fun allowedFrom(method: String, urls: List<String?>) = urls.map { Guard.allowed(method, it, hub) }

    private fun assertAll(method: String, urls: List<String?>, expected: Boolean) {
        urls.zip(allowedFrom(method, urls)).forEach { (u, got) -> assertEquals("$method from $u", expected, got) }
    }

    @Test fun bundledOnlyMethods() {
        for (m in listOf("probeHub", "setHubOrigin", "getHubOrigin")) {
            assertAll(m, bundledUrls, true)
            assertAll(m, hubPairUrls + hubOtherUrls + foreignUrls, false)
        }
    }

    @Test fun setDeviceTokenOnlyFromHubPair() {
        assertAll("setDeviceToken", hubPairUrls, true)
        assertAll("setDeviceToken", bundledUrls + hubOtherUrls + foreignUrls, false)
    }

    @Test fun confirmRevokedFromAnyHubPage() {
        assertAll("confirmRevoked", hubPairUrls + hubOtherUrls, true)
        assertAll("confirmRevoked", bundledUrls + foreignUrls, false)
    }

    @Test fun hubOrBundledMethods() {
        for (m in listOf("setSession", "setDeviceContext", "reportShown", "info", "health", "setWakeLock", "checkForUpdate", "openSetting", "addListener")) {
            assertAll(m, bundledUrls + hubPairUrls + hubOtherUrls, true)
            assertAll(m, foreignUrls, false)
        }
    }

    @Test fun noLockTaskExitAndUnknownMethodsRefused() {
        for (m in listOf("exitLockTask", "stopLockTask", "startLockTask", "foo", "")) {
            assertAll(m, bundledUrls + hubPairUrls + hubOtherUrls, false)
        }
    }

    @Test fun noStoredHubOriginMeansOnlyBundled() {
        assertFalse(Guard.allowed("confirmRevoked", "$hub/staff/", null))
        assertFalse(Guard.allowed("setDeviceToken", "$hub/pair", null))
        assertFalse(Guard.allowed("info", "$hub/staff/", null))
        assertTrue(Guard.allowed("info", "https://localhost/", null))
        assertFalse(Guard.allowed("info", "$hub/staff/", "garbage"))
    }

    @Test fun hubOriginComparedCaseInsensitivelyOnHost() {
        assertTrue(Guard.allowed("setDeviceToken", "http://hub.local:8080/pair", "http://HUB.local:8080"))
        assertTrue(Guard.allowed("info", "http://HUB.LOCAL:8080/staff/", "http://hub.local:8080"))
    }

    @Test fun everySpecMethodHasARule() {
        val spec = setOf(
            "info", "probeHub", "getHubOrigin", "setHubOrigin", "setDeviceToken", "confirmRevoked", "setSession",
            "setDeviceContext", "reportShown", "health", "openSetting", "setWakeLock", "checkForUpdate", "addListener",
        )
        assertEquals(spec, Guard.RULES.keys)
    }

    @Test fun hubOriginNormalize() {
        assertEquals("http://192.168.1.10:8080", HubOrigin.normalize("http://192.168.1.10:8080"))
        assertEquals("http://192.168.1.10:8080", HubOrigin.normalize(" http://192.168.1.10:8080/ "))
        assertEquals("http://hub.local:3000", HubOrigin.normalize("HTTP://Hub.Local:3000"))
        for (bad in listOf(
            null, "", "192.168.1.10:8080", "http://192.168.1.10", "https://192.168.1.10:8080",
            "http://192.168.1.10:8080/staff/", "http://192.168.1.10:8080/?a=1", "http://192.168.1.10:8080/#x",
            "http://u:p@192.168.1.10:8080", "http://192.168.1.10:0", "http://192.168.1.10:70000", "http://:8080",
            "ws://192.168.1.10:8080", "http://192.168.1.10:80 80",
        )) assertNull("bad $bad", HubOrigin.normalize(bad))
    }

    @Test fun tokenRuleRefusesNonTablet() {
        assertEquals(TokenRule.Result.Ok, TokenRule.check("t", "d", "tablet"))
        for (t in listOf("phone", "cashier_kiosk", "kds", "Tablet")) assertEquals(TokenRule.Result.NotTablet, TokenRule.check("t", "d", t))
        assertTrue(TokenRule.check("", "d", "tablet") is TokenRule.Result.Invalid)
        assertTrue(TokenRule.check("t", null, "tablet") is TokenRule.Result.Invalid)
        assertTrue(TokenRule.check("t", "d", null) is TokenRule.Result.Invalid)
        assertEquals("Approve this tablet as a Tablet", TokenRule.NOT_TABLET_MESSAGE)
    }
}
