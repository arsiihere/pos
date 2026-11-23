package pos.tablet

import org.json.JSONArray
import org.json.JSONObject

/**
 * 05b M-9: the lock-line and sound rules of the generated `assets/lock-strings.json`
 * (apps/tablet/scripts/gen-lock-strings.mjs documents the shape). Plain Kotlin + org.json, no Android classes,
 * so the JVM unit tests run it as is. It mirrors the generator's `renderLock` / `soundOf`, which the Vitest gate
 * checks against the page's own lock line (apps/client/src/features/alerts/labels.ts `lockText`) and `soundFor`.
 */
class LockStrings(json: String) {
    private val root = JSONObject(json)
    private val join: String = root.getString("join")
    private val fallback: String = root.getString("fallback_language")
    private val languages: Map<String, Map<String, String>> = root.getJSONObject("languages").let { langs ->
        langs.keys().asSequence().associateWith { lang ->
            val t = langs.getJSONObject(lang)
            t.keys().asSequence().associateWith { t.getString(it) }
        }
    }
    private val params: Map<String, String> = root.getJSONObject("params").let { p -> p.keys().asSequence().associateWith { p.getString(it) } }
    private val tableKey: String = root.getJSONObject("table").getString("key")
    private val tableDigits = Regex(root.getJSONObject("table").getString("digits"))
    private val tablePointKinds: Set<String> = strings(root.getJSONObject("table_point_kinds").getJSONArray("kinds")).toSet()
    private val tablePointParams: List<String> = strings(root.getJSONObject("table_point_kinds").getJSONArray("params"))
    private val takeawayKind: String = root.getJSONObject("takeaway").getString("kind")
    private val takeawayKey: String = root.getJSONObject("takeaway").getString("key")
    private val outcomeKind: String = root.getJSONObject("outcome").getString("kind")
    private val outcomeKey: String = root.getJSONObject("outcome").getString("key")
    private val unknownUrgent: String = root.getJSONObject("unknown").getString("urgent")
    private val unknownOther: String = root.getJSONObject("unknown").getString("other")
    private val silentKinds: Set<String> = strings(root.getJSONArray("silent_kinds")).toSet()
    private val resultKind: String = root.getJSONObject("result_sounds").getString("kind")
    private val resultDefault: String = root.getJSONObject("result_sounds").getString("default")
    private val resultByOutcome: Map<String, String> = root.getJSONObject("result_sounds").getJSONObject("by_outcome").let { o ->
        o.keys().asSequence().associateWith { o.getString(it) }
    }

    val version: Int = root.getInt("version")

    /** The template for [key] in [language] (a key missing from it reads the fallback language), or null. */
    fun template(language: String, key: String): String? {
        val own = languages[language] ?: languages[fallback]
        return own?.get(key) ?: languages[fallback]?.get(key)
    }

    /**
     * The lock line for an alert of [kind] / [family] with the lock-safe [lock] view
     * `{ kind_label_key, table_code, point_code, requester_name, device_name }` and a request_result's [outcome]
     * (AD-82, on the alert view). [onUnknown] gets a key that has no template; the generic text is used then.
     */
    fun line(kind: String, family: String?, outcome: String?, lock: JSONObject, language: String, onUnknown: (String) -> Unit = {}): String {
        val code = field(lock, params.getValue("table"))
        val table = when {
            code == null -> null
            tableDigits.matches(code) -> (template(language, tableKey) ?: "{code}").replace("{code}", code)
            else -> code
        }
        val all = params.mapValues { (name, f) -> if (name == "table") table else field(lock, f) }
        val tablePoint = kind in tablePointKinds
        val values = if (tablePoint) tablePointParams.associateWith { all[it] } else all
        if (!tablePoint && kind == takeawayKind && code == null) {
            return fill(template(language, takeawayKey) ?: takeawayKey, values)
        }
        val key = if (!tablePoint && kind == outcomeKind && outcome != null) {
            outcomeKey.replace("{outcome}", outcome)
        } else {
            lock.optString("kind_label_key", "")
        }
        val tpl = template(language, key) ?: run {
            onUnknown(key)
            val generic = if (!tablePoint && family == "urgent") unknownUrgent else unknownOther
            template(language, generic) ?: key
        }
        return fill(tpl, values)
    }

    /**
     * [line] from [o], the alert view (`{ family, outcome, lock, … }`) or only its `lock` (then `family` / `outcome`
     * are read from the lock if present).
     */
    fun lineOf(kind: String, o: JSONObject, language: String, onUnknown: (String) -> Unit = {}): String {
        val lock = o.optJSONObject("lock") ?: o
        return line(kind, field(o, "family"), field(o, "outcome"), lock, language, onUnknown)
    }

    /** [sound] with the outcome read from [o] (the alert view, or its lock), as [lineOf]. */
    fun soundOf(kind: String, family: String, o: JSONObject): String = sound(kind, family, field(o, "outcome"))

    fun isSilent(kind: String): Boolean = kind in silentKinds

    /** "urgent" | "action" | "info" | "result_approved" | "result_rejected" | "none" (post without a sound). */
    fun sound(kind: String, family: String, outcome: String?): String = when {
        isSilent(kind) -> NONE
        kind == resultKind -> outcome?.let { resultByOutcome[it] } ?: resultDefault
        else -> family
    }

    /** labels.ts fillLine. */
    private fun fill(template: String, values: Map<String, String?>): String {
        val parts = template.split(join)
        val kept = parts.filter { part -> PLACEHOLDER.findAll(part).all { !values[it.groupValues[1]].isNullOrEmpty() } }
        val filled = (kept.ifEmpty { parts }).map { part -> PLACEHOLDER.replace(part) { values[it.groupValues[1]] ?: "" } }
        return JS_SPACE.replace(filled.joinToString(join), " ").trim(' ')
    }

    companion object {
        const val NONE = "none"
        private val PLACEHOLDER = Regex("\\{(\\w+)\\}")
        // JS `\s`: Java's \s plus the Unicode spaces JS counts (so the collapse matches the page's)
        private val JS_SPACE = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")

        private fun strings(a: JSONArray): List<String> = (0 until a.length()).map { a.getString(it) }

        /** A string field; missing, JSON null or "" → null (labels.ts: a part with an empty parameter is dropped). */
        private fun field(o: JSONObject, name: String): String? =
            if (o.isNull(name)) null else o.optString(name, "").ifEmpty { null }
    }
}
