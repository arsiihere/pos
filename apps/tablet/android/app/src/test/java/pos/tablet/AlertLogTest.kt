package pos.tablet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

/** 05b M-19: JSONL rotated at a size, at most two files. */
class AlertLogTest {
    @Test fun rotatesKeepingTwoFiles() {
        val dir = Files.createTempDirectory("alertlog").toFile()
        val f = JsonlFile(dir, "log.jsonl", 100)
        repeat(5) { f.append("x".repeat(30)) } // 31 bytes a line
        assertTrue(f.current.exists())
        assertTrue(f.previous.exists())
        assertTrue(f.current.length() <= 100)
        assertEquals(setOf("log.jsonl", "log.jsonl.1"), dir.list()!!.toSet())
        assertEquals(2, f.current.readLines().size)
        assertEquals(3, f.previous.readLines().size)
        dir.deleteRecursively()
    }

    @Test fun noRotationUnderTheLimit() {
        val dir = Files.createTempDirectory("alertlog").toFile()
        val f = JsonlFile(dir, "log.jsonl", 1000)
        repeat(3) { f.append("{\"ev\":\"x\"}") }
        assertFalse(f.previous.exists())
        assertEquals(3, f.current.readLines().size)
        dir.deleteRecursively()
    }
}
