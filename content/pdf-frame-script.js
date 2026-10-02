/**
 * Reliable parent/content bridge for the embedded PDF viewer.
 * XUL <browser> elements do not expose contentWindow consistently in current
 * Zotero builds, so PDF bytes and readiness events travel through the browser
 * message manager instead.
 */

function zbPdfContentTarget() {
  try {
    return content.wrappedJSObject || content;
  } catch (e) {
    return content;
  }
}

function zbPdfReportReady() {
  try {
    let target = zbPdfContentTarget();
    if (target && target.__zbPdfReady && typeof target.zbOpenPdf === "function") {
      sendAsyncMessage("zb-pdf-event", { type: "zb-pdf-ready" });
      return true;
    }
  } catch (e) {}
  return false;
}

let zbPdfReadyTimer = null;
function zbPdfStartReadyPoll() {
  if (zbPdfReadyTimer) {
    clearInterval(zbPdfReadyTimer);
  }
  let attempts = 0;
  zbPdfReadyTimer = setInterval(() => {
    attempts++;
    if (zbPdfReportReady() || attempts >= 300) {
      clearInterval(zbPdfReadyTimer);
      zbPdfReadyTimer = null;
      if (attempts >= 300) {
        sendAsyncMessage("zb-pdf-event", {
          type: "zb-pdf-error",
          message: "PDF 阅读器脚本未能启动"
        });
      }
    }
  }, 50);
}

addMessageListener("zb-pdf-command", function (message) {
  let data = message.data || {};
  let target = zbPdfContentTarget();
  try {
    let cloned = Components.utils.cloneInto(data, target);
    if (data.type === "zb-pdf-open" && typeof target.zbOpenPdf === "function") {
      Promise.resolve(target.zbOpenPdf(cloned)).catch((err) => {
        sendAsyncMessage("zb-pdf-event", {
          type: "zb-pdf-error",
          message: err && err.message ? err.message : String(err)
        });
      });
      return;
    }
    target.postMessage(cloned, "*");
  } catch (err) {
    sendAsyncMessage("zb-pdf-event", {
      type: "zb-pdf-error",
      message: err && err.message ? err.message : String(err)
    });
  }
});

addEventListener("message", function (event) {
  let data = event.data;
  if (!data || typeof data.type !== "string" || !data.type.startsWith("zb-pdf-")) {
    return;
  }
  // Forward the full payload: window.postMessage from a content <browser>
  // does not reliably reach the chrome window, so link clicks, selections
  // and debug info all travel over the message manager instead.
  try {
    sendAsyncMessage("zb-pdf-event", {
      type: data.type,
      message: data.message || "",
      url: data.url || "",
      text: data.text || "",
      rect: data.rect || null
    });
  } catch (e) {}
}, true);

addEventListener("DOMContentLoaded", function (event) {
  if (event.target && event.target.defaultView !== content) {
    return;
  }
  zbPdfStartReadyPoll();
}, true);

zbPdfStartReadyPoll();
