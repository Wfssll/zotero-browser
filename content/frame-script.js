/**
 * Fallback content-process script for Firefox builds that still expose loadFrameScript.
 */

// Preserve Gecko's native navigator properties and challenge execution.
function zbIsChallengeDocument() {
  try {
    let url = String(content.location.href);
    let doc = content.document;
    return /(?:challenges\.cloudflare\.com|hcaptcha\.com|recaptcha|\/cdn-cgi\/)/i.test(url) ||
      /just a moment|verify you are human|checking your browser|安全验证|请稍候/i.test(doc.title || "") ||
      !!doc.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], iframe[src*="hcaptcha.com"]');
  } catch (e) { return false; }
}

function zbIsPdfHref(url) {
  if (!url) {
    return false;
  }
  return /arxiv\.org\/pdf\//i.test(url) ||
    /export\.arxiv\.org\/pdf\//i.test(url) ||
    /\.pdf(?:$|[?#])/i.test(url);
}

function zbHandleBilibiliSearch(event) {
  if (zbIsChallengeDocument()) return false;
  try {
    let host = content.location && content.location.hostname || "";
    if (!/(^|\.)bilibili\.com$/i.test(host)) {
      return false;
    }
    let target = event.target;
    let input = null;
    if (event.type === "keydown") {
      if (event.key !== "Enter" || !target || !target.matches ||
          !target.matches(".nav-search-input, input[name='keyword'], .nav-search-content input")) {
        return false;
      }
      input = target;
    } else {
      let button = target && target.closest && target.closest(
        ".nav-search-btn, button.nav-search-btn, .nav-search-content button"
      );
      if (!button) {
        return false;
      }
      let container = button.closest("form, .nav-search, .nav-search-content") || content.document;
      input = container.querySelector(
        ".nav-search-input, input[name='keyword'], .nav-search-content input, input"
      );
    }
    let keyword = input && String(input.value || "").trim();
    if (!keyword) {
      return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    sendAsyncMessage("zb-navigate", {
      url: "https://search.bilibili.com/all?keyword=" + encodeURIComponent(keyword),
      pdf: false,
      newTab: true
    });
    return true;
  } catch (e) {
    return false;
  }
}

// 内置 PDF 阅读器以 resource:// 加载，WindowActor 的 matches(http/https) 覆盖不到它，
// 因此阅读器里的链接点击与划词统一由本脚本桥接回父进程。
function zbIsPdfViewerPage() {
  try {
    let href = (content.location && content.location.href) || "";
    return href.startsWith("resource://zotero-browser/content/pdf-viewer.html") ||
      href.startsWith("chrome://zotero-browser/content/pdf-viewer.html");
  } catch (e) {
    return false;
  }
}

function zbHandleWebLink(event) {
  if (zbIsChallengeDocument()) return false;
  let link = event.target && event.target.closest &&
    event.target.closest("a[href], area[href]");
  if (!link || !link.href || !/^https?:\/\//i.test(link.href) ||
      link.hasAttribute("download")) {
    return false;
  }
  try {
    let current = new URL(content.location.href);
    let destination = new URL(link.href);
    if (destination.hash && current.origin === destination.origin &&
        current.pathname === destination.pathname && current.search === destination.search) {
      return false;
    }
  } catch (e) {}
  // PDF 阅读器中的链接必须在新标签页打开：原地导航会把阅读器（含页数/缩放
  // 工具栏）整个替换掉。fromPdfViewer 让父进程用后台标签页打开并给出提示。
  let inPdfViewer = zbIsPdfViewerPage();
  let targetName = String(link.getAttribute("target") || "").toLowerCase();
  let opensOutsideCurrent = !!targetName &&
    targetName !== "_self" && targetName !== "_top" && targetName !== "_parent";
  let newTab = inPdfViewer || event.type === "auxclick" || event.ctrlKey || event.metaKey ||
    event.shiftKey || opensOutsideCurrent;
  if (!newTab && !zbIsPdfHref(link.href)) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  try {
    sendAsyncMessage("zb-navigate", {
      url: link.href,
      pdf: zbIsPdfHref(link.href),
      newTab,
      fromPdfViewer: inPdfViewer
    });
  } catch (e) {
    if (!newTab) {
      try {
        content.location.assign(link.href);
      } catch (e2) {}
    }
  }
  return true;
}

addEventListener("keydown", function (event) {
  try {
    const command = ChromeUtils.importESModule("resource://zotero-browser/content/zoom.sys.mjs").zbZoom.command(event);
    if (command && event.isTrusted !== false) {
      event.preventDefault(); event.stopImmediatePropagation();
      sendAsyncMessage("zb-page-zoom", { command }); return;
    }
  } catch (_) {}
  zbHandleBilibiliSearch(event);
}, true);

addEventListener("click", function (event) {
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  if (event.altKey) {
    return;
  }
  if (zbHandleBilibiliSearch(event)) {
    return;
  }
  zbHandleWebLink(event);
}, true);

addEventListener("auxclick", function (event) {
  if (event.defaultPrevented || event.button !== 1) {
    return;
  }
  if (event.altKey) {
    return;
  }
  zbHandleWebLink(event);
}, true);

// 划词上报（仅内置 PDF 阅读器页面；普通网页由 WindowActor 上报）。
// 父进程收到后调用 Zotero 里已安装的翻译插件并弹出翻译卡片。
let zbLastReportedSelection = "";
function zbReportPdfViewerSelection() {
  if (!zbIsPdfViewerPage()) {
    return;
  }
  try {
    let sel = content.getSelection ? content.getSelection() : null;
    let text = sel ? String(sel).trim() : "";
    if (text === zbLastReportedSelection) {
      return;
    }
    zbLastReportedSelection = text;
    let rect = null;
    if (text && sel.rangeCount) {
      let r = sel.getRangeAt(0).getBoundingClientRect();
      rect = { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom };
    }
    sendAsyncMessage("zb-selection", { text, rect });
  } catch (e) {}
}

addEventListener("mouseup", function () {
  try {
    content.setTimeout(zbReportPdfViewerSelection, 30);
  } catch (e) {}
}, true);

addEventListener("keyup", function (event) {
  if (event.shiftKey || event.key === "Shift") {
    try {
      content.setTimeout(zbReportPdfViewerSelection, 30);
    } catch (e) {}
  }
}, true);

// PDF 阅读器的缩放状态记忆：阅读器 emit 的 postMessage 在内容进程收到后
// 转发给父进程写入 Zotero 偏好（resource:// 页面的 localStorage 不可靠）。
addEventListener("message", function (event) {
  if (!zbIsPdfViewerPage()) {
    return;
  }
  let data = event.data;
  if (data && data.type === "zb-pdf-zoomstate") {
    try {
      sendAsyncMessage("zb-pdf-zoomstate", {
        zoom: data.zoom,
        fitWidth: !!data.fitWidth
      });
    } catch (e) {}
  }
}, false);
