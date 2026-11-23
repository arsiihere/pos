package pos.tablet

// TEMPORARY (lane 2 only): stands in for lane 1's HubProbe so this branch compiles. The integrator deletes this
// file when lane 1 lands (lane 1 owns the real HubProbe / ProbeResult, M-16).
object HubProbe { fun probe(origin: String): ProbeResult = ProbeResult(false, "no_hub", null) }

data class ProbeResult(val ok: Boolean, val reason: String?, val message: String?)
