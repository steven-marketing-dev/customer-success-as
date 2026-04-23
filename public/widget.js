/*!
 * Customer Success embeddable help widget
 * Usage:
 *   <script src="https://YOUR-HOST/widget.js" data-key="cs_xxx" defer></script>
 * Then, to toggle from any existing button in the host page:
 *   <button onclick="window.CSAgent.toggle()">Help</button>
 *
 * Optional data attributes:
 *   data-auto-launcher="true"  — render a floating bubble if the host has no button
 *   data-host="https://YOUR-HOST" — override the host origin (defaults to the script's own origin)
 *   data-position="right|left" — which side the panel anchors to (default right)
 */
(function () {
  "use strict";

  if (window.CSAgent) return; // already loaded

  var currentScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();

  var widgetKey = currentScript && currentScript.getAttribute("data-key");
  if (!widgetKey) {
    console.error("[CSAgent] Missing data-key on <script> tag");
    return;
  }

  var autoLauncher = currentScript.getAttribute("data-auto-launcher") === "true";
  var position = currentScript.getAttribute("data-position") === "left" ? "left" : "right";
  var host = currentScript.getAttribute("data-host");
  if (!host) {
    try {
      var src = currentScript.getAttribute("src") || "";
      var u = new URL(src, window.location.href);
      host = u.origin;
    } catch (e) {
      console.error("[CSAgent] Could not resolve host origin", e);
      return;
    }
  }

  var iframeSrc = host + "/embed/chat?key=" + encodeURIComponent(widgetKey);

  var isOpen = false;
  var container = null;
  var iframe = null;
  var launcher = null;

  function createContainer() {
    var c = document.createElement("div");
    c.id = "cs-agent-container";
    c.style.cssText = [
      "position:fixed",
      "bottom:20px",
      position + ":20px",
      "width:380px",
      "height:600px",
      "max-width:calc(100vw - 40px)",
      "max-height:calc(100vh - 40px)",
      "z-index:2147483646",
      "border-radius:16px",
      "overflow:hidden",
      "box-shadow:0 12px 40px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)",
      "background:white",
      "display:none",
      "transform-origin:bottom " + position,
      "transition:opacity 0.15s ease-out, transform 0.15s ease-out",
      "opacity:0",
    ].join(";");

    var f = document.createElement("iframe");
    f.src = iframeSrc;
    f.title = "Help assistant";
    f.style.cssText = "width:100%;height:100%;border:0;display:block;background:white";
    f.setAttribute("allow", "");
    f.setAttribute("referrerpolicy", "no-referrer");

    c.appendChild(f);
    document.body.appendChild(c);
    iframe = f;
    return c;
  }

  function createLauncher() {
    var btn = document.createElement("button");
    btn.id = "cs-agent-launcher";
    btn.type = "button";
    btn.setAttribute("aria-label", "Open help");
    btn.style.cssText = [
      "position:fixed",
      "bottom:20px",
      position + ":20px",
      "width:52px",
      "height:52px",
      "border-radius:26px",
      "background:#0d9488",
      "color:white",
      "border:0",
      "cursor:pointer",
      "z-index:2147483645",
      "box-shadow:0 6px 16px rgba(0,0,0,0.2)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-family:-apple-system,system-ui,sans-serif",
    ].join(";");
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    btn.addEventListener("click", toggle);
    document.body.appendChild(btn);
    return btn;
  }

  function ensureContainer() {
    if (!container) container = createContainer();
    return container;
  }

  function open() {
    var c = ensureContainer();
    c.style.display = "block";
    // allow layout to flush before animating
    requestAnimationFrame(function () {
      c.style.opacity = "1";
      c.style.transform = "translateY(0) scale(1)";
    });
    isOpen = true;
  }

  function close() {
    if (!container) { isOpen = false; return; }
    container.style.opacity = "0";
    container.style.transform = "translateY(8px) scale(0.98)";
    setTimeout(function () {
      if (container) container.style.display = "none";
    }, 180);
    isOpen = false;
  }

  function toggle() { if (isOpen) close(); else open(); }

  // Listen for close events from the iframe
  window.addEventListener("message", function (event) {
    if (!event.data || event.data.source !== "cs-widget") return;
    // We trust messages that come from our iframe's contentWindow
    if (iframe && event.source !== iframe.contentWindow) return;
    if (event.data.type === "cs-widget-close") close();
  });

  // Expose public API
  window.CSAgent = {
    open: open,
    close: close,
    toggle: toggle,
    get isOpen() { return isOpen; },
  };

  // Auto-launcher (optional — hosts with their own button don't need it)
  function init() {
    if (autoLauncher) launcher = createLauncher();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Silence unused-var lint: reference launcher
  void launcher;
})();
