package pos.tablet

import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeWebViewClient

/**
 * 05b M-1 (N-2) and M-4 (render process): Capacitor's client with two changes.
 * - A failed load of the hub origin's **main frame** (network error or HTTP error) calls [onMainFrameFailure]
 *   once (the activity recreates into the bundled unreachable page). A failed subresource, or the hub stopping
 *   under an already-loaded page (its fetches and sockets fail; no main-frame request), never reloads it.
 * - A gone render process is handled (`true`) and [onRenderGone] recreates the activity, instead of the
 *   default `false` that kills the whole app process.
 * Everything else goes to [BridgeWebViewClient] (local server, navigation rule, WebViewListeners).
 */
class HubWebViewClient(
    bridge: Bridge,
    private val hubOrigin: String?,
    private val onMainFrameFailure: (reason: String) -> Unit,
    private val onRenderGone: () -> Unit,
) : BridgeWebViewClient(bridge) {
    private var failed = false

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        super.onReceivedError(view, request, error)
        if (isHubMainFrame(request)) fail(StartPage.mainFrameFailureReason(0))
    }

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
        super.onReceivedHttpError(view, request, errorResponse)
        if (isHubMainFrame(request)) fail(StartPage.mainFrameFailureReason(errorResponse.statusCode))
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        super.onRenderProcessGone(view, detail) // lets WebViewListeners see it
        onRenderGone()
        return true
    }

    private fun isHubMainFrame(request: WebResourceRequest): Boolean =
        hubOrigin != null && request.isForMainFrame && StartPage.sameOrigin(request.url?.toString(), hubOrigin)

    private fun fail(reason: String) {
        if (failed) return
        failed = true
        onMainFrameFailure(reason)
    }
}
