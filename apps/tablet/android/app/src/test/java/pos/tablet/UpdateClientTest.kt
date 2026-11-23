package pos.tablet

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.concurrent.Executor

/** 05b test 16: install window, sha256 refusal, not-higher → nothing; plus the M-15 flow and its HTTP part. */
class UpdateClientTest {
    // ---------------------------------------------------------------- fakes

    private class QueueExec : Executor {
        val q = ArrayDeque<Runnable>()
        override fun execute(command: Runnable) { q.addLast(command) }
        fun runAll() { while (q.isNotEmpty()) q.removeFirst().run() }
    }

    private class FakeIo(var latest: Latest, var bytes: ByteArray) : UpdateIo {
        var downloads = 0
        val installs = mutableListOf<Pair<Long, Boolean>>()
        override fun latest() = latest
        override fun download(release: Release, dest: File): Boolean {
            downloads++
            dest.writeBytes(bytes)
            return true
        }
        override fun install(apk: File, release: Release, deviceOwner: Boolean) { installs.add(release.versionCode to deviceOwner) }
    }

    private class FakeEnv : UpdateEnv {
        var t = 1_000_000L
        var signedIn: Boolean? = false
        var urgent = 0
        var owner = true
        var last = 0L
        override fun now() = t
        override fun signedIn() = signedIn
        override fun openUnseenUrgent() = urgent
        override fun deviceOwner() = owner
        override fun lastCheck() = last
        override fun setLastCheck(t: Long) { last = t }
    }

    private val apk = "fake apk bytes".toByteArray()
    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    private lateinit var dir: File
    private val exec = QueueExec()
    private val env = FakeEnv()
    private val states = mutableListOf<UpdateState>()

    @Before fun setUp() { dir = Files.createTempDirectory("upd").toFile() }
    @After fun tearDown() { dir.deleteRecursively(); try { server.shutdown() } catch (_: Exception) {} }

    private fun client(io: UpdateIo, current: Long = 5) =
        UpdateClient(current, dir, io, env, exec, { states.add(it) }).also { exec.runAll() }

    private fun found(code: Long, s: String = sha(apk)) = Latest.Found(Release("0.1.$code", code, s))

    // ---------------------------------------------------------------- pure policy (test 16)

    @Test fun windowNeedsSignedOutAndNoOpenUnseenUrgent() {
        assertTrue(UpdatePolicy.windowOpen(false, 0))
        assertFalse(UpdatePolicy.windowOpen(true, 0))
        assertFalse("unknown after a :alerts restart → closed (N-1)", UpdatePolicy.windowOpen(null, 0))
        assertFalse(UpdatePolicy.windowOpen(false, 1))
        assertFalse(UpdatePolicy.windowOpen(true, 3))
    }

    @Test fun onlyAHigherVersionCode() {
        assertTrue(UpdatePolicy.isNewer(6, 5))
        assertFalse(UpdatePolicy.isNewer(5, 5))
        assertFalse(UpdatePolicy.isNewer(4, 5))
    }

    @Test fun shaCompare() {
        val s = sha(apk)
        assertTrue(UpdatePolicy.shaMatches(s, s))
        assertTrue(UpdatePolicy.shaMatches(s.uppercase(), s))
        assertFalse(UpdatePolicy.shaMatches(s, sha("other".toByteArray())))
        assertFalse(UpdatePolicy.shaMatches("", ""))
        assertEquals(s, UpdatePolicy.sha256Hex(apk.inputStream()))
    }

    @Test fun hourlyDue() {
        assertTrue(UpdatePolicy.due(10, 0))
        assertFalse(UpdatePolicy.due(1_000 + Spec.UPDATE_CHECK_MS - 1, 1_000))
        assertTrue(UpdatePolicy.due(1_000 + Spec.UPDATE_CHECK_MS, 1_000))
        assertTrue("clock went back", UpdatePolicy.due(500, 1_000))
    }

    @Test fun parseLatest() {
        val r = UpdatePolicy.parseLatest("""{"data":{"version_name":"0.1.7","version_code":7,"sha256":"ab","staged_device_id":null}}""")
        assertEquals(Release("0.1.7", 7, "ab"), r)
        assertNull(UpdatePolicy.parseLatest("""{"data":{"version_code":0,"sha256":"ab"}}"""))
        assertNull(UpdatePolicy.parseLatest("""{"data":{"version_code":7}}"""))
        assertNull(UpdatePolicy.parseLatest("not json"))
        assertNull(UpdatePolicy.parseLatest(null))
    }

    // ---------------------------------------------------------------- client flow

    @Test fun notHigherDoesNothing() {
        val io = FakeIo(found(5), apk)
        val c = client(io)
        c.checkAsync("reconnect"); exec.runAll()
        assertEquals(UpdateState.NONE, c.state)
        assertEquals(0, io.downloads)
        assertTrue(io.installs.isEmpty())
        assertEquals("check recorded for the hourly schedule", env.t, env.last)
    }

    @Test fun shaMismatchRefuses() {
        val io = FakeIo(found(6, sha("something else".toByteArray())), apk)
        val c = client(io)
        c.checkAsync("reconnect"); exec.runAll()
        assertEquals(UpdateState.NONE, c.state)
        assertEquals(1, io.downloads)
        assertTrue(io.installs.isEmpty())
        assertFalse("bad download deleted", c.apkFile(6).exists())
        assertEquals(listOf(UpdateState.DOWNLOADING, UpdateState.NONE), states)
    }

    @Test fun deviceOwnerInstallsInTheWindow() {
        val io = FakeIo(found(6), apk)
        val c = client(io)
        c.checkAsync("reconnect"); exec.runAll()
        assertEquals(listOf(6L to true), io.installs)
        assertEquals(UpdateState.INSTALLING, c.state)
        assertEquals(listOf(UpdateState.DOWNLOADING, UpdateState.READY, UpdateState.INSTALLING), states)
        assertTrue(c.apkFile(6).exists())
    }

    @Test fun signedInWaitsThenInstallsAfterSignOut() {
        env.signedIn = true
        val io = FakeIo(found(6), apk)
        val c = client(io)
        c.checkAsync("reconnect"); exec.runAll()
        assertEquals(UpdateState.READY, c.state)
        assertTrue(c.updateReady)
        assertTrue(io.installs.isEmpty())
        env.signedIn = false
        c.windowMayHaveOpened(); exec.runAll()
        assertEquals(1, io.installs.size)
    }

    @Test fun unknownSessionKeepsTheWindowClosed() {
        env.signedIn = null
        val io = FakeIo(found(6), apk)
        val c = client(io)
        c.checkAsync("upgrade_required"); exec.runAll()
        assertEquals(UpdateState.READY, c.state)
        assertTrue(io.installs.isEmpty())
    }

    @Test fun openUnseenUrgentWaitsUntilTheNextTick() {
        env.urgent = 1
        val io = FakeIo(found(6), apk)
        val c = client(io)
        c.checkAsync("reconnect"); exec.runAll()
        assertTrue(io.installs.isEmpty())
        env.urgent = 0
        env.t += 60_000 // not due for a new check: the tick only retries the install
        c.tickAsync(); exec.runAll()
        assertEquals(1, io.installs.size)
        assertEquals(1, io.downloads)
    }

    @Test fun checkNowAnswersDownloadingBeforeTheDownload() {
        val io = FakeIo(found(6), apk)
        val c = client(io)
        var answered: UpdateState? = null
        c.checkNow("check_for_update") { answered = it }
        exec.runAll()
        assertEquals(UpdateState.DOWNLOADING, answered)
        assertEquals(UpdateState.INSTALLING, c.state)
    }

    @Test fun nonOwnerPromptIsRetriedHourlyNotEveryTick() {
        env.owner = false
        val io = FakeIo(found(6), apk)
        val c = client(io)
        c.checkAsync("reconnect"); exec.runAll()
        assertEquals(listOf(6L to false), io.installs)
        c.onInstallResult(InstallResult.PENDING_USER_ACTION, null); exec.runAll()
        assertEquals(UpdateState.READY, c.state)
        c.onInstallResult(InstallResult.FAILED, "aborted"); exec.runAll() // user dismissed the prompt
        env.t += 10 * 60_000
        c.windowMayHaveOpened(); exec.runAll()
        assertEquals(1, io.installs.size)
        env.t += Spec.UPDATE_CHECK_MS
        c.windowMayHaveOpened(); exec.runAll()
        assertEquals(2, io.installs.size)
    }

    @Test fun noReleaseDropsADownloadedOne() {
        env.signedIn = true
        val io = FakeIo(found(6), apk)
        val c = client(io)
        c.checkAsync("reconnect"); exec.runAll()
        assertTrue(c.apkFile(6).exists())
        io.latest = Latest.NoRelease
        c.checkAsync("hourly"); exec.runAll()
        assertEquals(UpdateState.NONE, c.state)
        assertFalse(c.apkFile(6).exists())
    }

    @Test fun failedCheckKeepsState() {
        env.signedIn = true
        val io = FakeIo(found(6), apk)
        val c = client(io)
        c.checkAsync("reconnect"); exec.runAll()
        io.latest = Latest.Failed("UNREACHABLE")
        c.checkAsync("reconnect"); exec.runAll()
        assertEquals(UpdateState.READY, c.state)
        assertEquals(1, io.downloads)
    }

    @Test fun startupDropsOldAndPartialFiles() {
        File(dir, "4.apk").writeText("old")
        File(dir, "5.apk").writeText("current")
        File(dir, "7.apk.part").writeText("partial")
        File(dir, "7.apk").writeBytes(apk)
        val io = FakeIo(found(7), apk)
        val c = client(io)
        assertEquals(setOf("7.apk"), dir.list()!!.toSet())
        c.checkAsync("reconnect"); exec.runAll()
        assertEquals("a verified file already there is reused", 0, io.downloads)
        assertEquals(1, io.installs.size)
    }

    // ---------------------------------------------------------------- HTTP part

    private val server = MockWebServer()

    private fun http(token: String? = "tok") =
        UpdateHttp({ server.url("/").toString().trimEnd('/') }, { token }, "0.1.5")

    @Test fun latestSendsTokenAndClientVersion() {
        server.enqueue(MockResponse().setBody("""{"data":{"version_name":"0.1.6","version_code":6,"sha256":"aa","staged_device_id":null}}"""))
        val l = http().latest()
        assertEquals(Latest.Found(Release("0.1.6", 6, "aa")), l)
        val req = server.takeRequest()
        assertEquals("/app/android/latest", req.path)
        assertEquals("Bearer tok", req.getHeader("Authorization"))
        assertEquals("0.1.5", req.getHeader("X-Client-Version"))
    }

    @Test fun latestNoReleaseAndErrors() {
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":{"code":"ROUTE_NOT_FOUND"}}"""))
        assertEquals(Latest.NoRelease, http().latest())
        server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":{"code":"GUEST_NETWORK_FORBIDDEN"}}"""))
        assertEquals(Latest.Failed("GUEST_NETWORK_FORBIDDEN"), http().latest())
        assertEquals(Latest.Failed("NOT_PAIRED"), http(token = null).latest())
    }

    @Test fun downloadWritesTheApk() {
        server.enqueue(MockResponse().setBody(Buffer().write(apk)))
        val dest = File(dir, "6.apk")
        assertTrue(http().download(Release("0.1.6", 6, sha(apk)), dest))
        assertEquals(sha(apk), UpdatePolicy.sha256Hex(dest))
        val req = server.takeRequest()
        assertEquals("/app/android/6.apk", req.path)
        assertEquals("Bearer tok", req.getHeader("Authorization"))
        assertFalse(File(dir, "6.apk.part").exists())
    }

    @Test fun downloadFailureLeavesNothing() {
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":{"code":"ROUTE_NOT_FOUND"}}"""))
        val dest = File(dir, "6.apk")
        assertFalse(http().download(Release("0.1.6", 6, "x"), dest))
        assertFalse(dest.exists())
        assertFalse(File(dir, "6.apk.part").exists())
    }
}
