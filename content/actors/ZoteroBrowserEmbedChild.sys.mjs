import { zbZoom } from "../zoom.sys.mjs";

// 验证页出现次数（按 browsingContext 计）：识别 Cloudflare 自身反复
// 重载验证页的「循环验证」，供父进程给出更强的引导提示。
const ZbChallengeHits = new WeakMap();

export class ZoteroBrowserEmbedChild extends JSWindowActorChild {
  receiveMessage(message) {
    if (message.name !== "PDFZoom") return null;
    const win = this.contentWindow;
    const target = win?.wrappedJSObject || win;
    return typeof target?.zbZoomPdfPage === "function" ? target.zbZoomPdfPage(message.data?.command) : null;
  }
  /**
   * 第三方人机验证的 iframe（Cloudflare Turnstile / challenge-platform、
   * hCaptcha、reCAPTCHA、极验、Arkose）由站点自行处理。
   * 这些 frame 不参与插件的导航和选文事件处理。
   */
  _isCaptchaFrame() {
    if (this._zbCaptchaFrame !== undefined) {
      return this._zbCaptchaFrame;
    }
    this._zbCaptchaFrame = false;
    try {
      let loc = this.contentWindow.location;
      let host = String(loc.hostname || "").toLowerCase();
      let path = String(loc.pathname || "");
      if (/(^|\.)(hcaptcha\.com|recaptcha\.net|geetest\.com|arkoselabs\.com|arkoselabs\.cn)$/.test(host) ||
          host === "challenges.cloudflare.com" ||
          ((/(^|\.)cloudflare\.com$/.test(host) || /(^|\.)google\.com$/.test(host)) &&
            (path.startsWith("/cdn-cgi/") || path.startsWith("/recaptcha/"))) ||
          path.includes("/cdn-cgi/challenge-platform/") ||
          path.includes("/cdn-cgi/turnstile/")) {
        this._zbCaptchaFrame = true;
      }
    } catch (e) {}
    return this._zbCaptchaFrame;
  }
  /**
   * Report the current text selection (and its on-screen rect) to the parent
   * so the chrome UI can show a translate popover. Only the top frame reports,
   * so coordinates line up with the <browser> element.
   */
  _reportSelectionSoon() {
    try {
      if (this.browsingContext && this.browsingContext.parent) {
        return;
      }
    } catch (e) {}
    let win = this.contentWindow;
    if (!win) {
      return;
    }
    win.setTimeout(() => {
      try {
        let sel = win.getSelection();
        let text = sel ? String(sel).trim() : "";
        let rect = null;
        if (text && sel.rangeCount) {
          let r = sel.getRangeAt(0).getBoundingClientRect();
          rect = { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom };
        }
        this.sendAsyncMessage("Selection", { text, rect });
      } catch (e) {}
    }, 30);
  }

  _isPdfUrl(url) {
    if (!url || typeof url !== "string") {
      return false;
    }
    if (/^(javascript|mailto|blob|data):/i.test(url)) {
      return false;
    }
    return /arxiv\.org\/pdf\//i.test(url) ||
      /export\.arxiv\.org\/pdf\//i.test(url) ||
      /\.pdf(?:$|[?#])/i.test(url);
  }

  _handleBilibiliSearch(event) {
    try {
      let win = this.contentWindow;
      let host = win && win.location && win.location.hostname || "";
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
        let container = button.closest("form, .nav-search, .nav-search-content") || win.document;
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
      this.sendAsyncMessage("Navigate", {
        url: "https://search.bilibili.com/all?keyword=" + encodeURIComponent(keyword),
        pdf: false,
        newTab: true
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  _isPdfViewerPage() {
    try {
      let href = (this.contentWindow.location && this.contentWindow.location.href) || "";
      return href.startsWith("resource://zotero-browser/content/pdf-viewer.html") ||
        href.startsWith("chrome://zotero-browser/content/pdf-viewer.html");
    } catch (e) {
      return false;
    }
  }

  // ---- 人机验证（Cloudflare 等）卡点检测 ----
  // Detection is advisory only; never refresh or manipulate the challenge.
  _detectChallengeKind() {
    try {
      let doc = this.document;
      if (!doc || !doc.body) {
        return false;
      }
      let title = doc.title || "";
      let text = (doc.body.innerText || "").slice(0, 1500);
      if (/attention required|access denied/i.test(title) ||
          /you have been blocked|you are unable to access|error code:\s*10\d\d|被封禁|已被阻止/i.test(text)) {
        return "blocked";
      }
      if (/just a moment|请稍候|请稍等|checking your browser|checking if the site|verify you are human|review the security/i.test(title)) {
        return "challenge";
      }
      if (/正在进行安全验证|验证您不是自动程序|checking your browser|verify you are human/i.test(text) &&
          /ray id|cloudflare|安全服务|security service/i.test(text)) {
        return "challenge";
      }
    } catch (e) {}
    return false;
  }

  _hasVisibleChallengeWidget() {
    try {
      let el = this.document.querySelector(
        'iframe[src*="challenges.cloudflare.com"], .cf-turnstile iframe, #cf-chl-widget, div.cf-turnstile'
      );
      return !!(el && el.offsetWidth > 0 && el.offsetHeight > 0);
    } catch (e) {
      return false;
    }
  }

  // 点击时用的轻量判断：只看 title + 少量 DOM 特征。不能复用
  // _detectChallengeKind()，它读 body.innerHTML 会在大页面上强制序列化整棵 DOM。
  _isChallengePageNow() {
    try {
      let doc = this.document;
      if (!doc) {
        return false;
      }
      if (/just a moment|attention required|access denied|请稍候|请稍等|安全验证|verify you are human|checking your browser/i.test(doc.title || "")) {
        return true;
      }
      return !!doc.querySelector(
        '#cf-chl-widget, .cf-turnstile, iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"], iframe[src*="geetest.com"]'
      );
    } catch (e) {
      return false;
    }
  }

  _scheduleChallengeCheck() {
    if (this.browsingContext.parent) {
      return; // 只检测顶层页面
    }
    let win = this.contentWindow;
    if (!win) {
      return;
    }
    for (let d of [1500, 3500, 7000, 15000, 30000, 60000]) {
      win.setTimeout(() => this._checkChallengePage(d), d);
    }
  }

  _checkChallengePage(delay) {
    try {
      let kind = this._detectChallengeKind();
      if (!kind) {
        if (this._zbChallengeReported) {
          this.sendAsyncMessage("Captcha", { url: this.contentWindow.location.href, cleared: true });
          this._zbChallengeReported = false;
        }
        return;
      }
      // Leave an active challenge unobstructed while its own scripts run.
      if (kind !== "blocked" && Number(delay) < 15000) return;
      let win = this.contentWindow;
      let hasWidget = this._hasVisibleChallengeWidget();
      // 统计同一标签页 60 秒内「验证页加载次数」：Cloudflare 验证不通过时会
      // 自己反复重载页面（非插件行为）。一次文档加载只计一次，否则同一页的
      // 多次定时检查会被误判成循环验证。
      let now = Date.now();
      let bc = null;
      try {
        bc = this.browsingContext && this.browsingContext.top;
      } catch (e) {}
      let hits = (bc && ZbChallengeHits.get(bc)) || [];
      hits = hits.filter(t => now - t < 60000);
      if (!this._zbChallengeCounted) {
        this._zbChallengeCounted = true;
        hits.push(now);
        if (bc) {
          ZbChallengeHits.set(bc, hits);
        }
      }
      // 不自动重载：用户正在点击验证框时 reload 会重置验证进度，导致
      // 「点一下就重启」的死循环。只上报状态，由提示条引导用户手动完成验证。
      this._zbChallengeReported = true;
      this.sendAsyncMessage("Captcha", {
        url: win.location.href,
        hasWidget,
        blocked: kind === "blocked",
        loop: hits.length >= 4,
        // Report a delayed check; this does not establish why verification failed.
        stuck: !hasWidget && kind === "challenge" && Number(delay) >= 7000
      });
    } catch (e) {}
  }

  handleEvent(event) {
    if (event.type === "keydown" && event.isTrusted !== false) {
      const command = zbZoom.command(event);
      if (command) {
        event.preventDefault(); event.stopImmediatePropagation();
        this.sendAsyncMessage("Zoom", { command }); return;
      }
    }
    if (this._isCaptchaFrame()) {
      return; // 验证框架内不做任何拦截，交给站点自己的脚本
    }
    if (event.type === "DOMContentLoaded") {
      this._scheduleChallengeCheck();
      return;
    }
    if (this._isChallengePageNow()) return;
    if (event.type === "mouseup") {
      this._reportSelectionSoon();
      return;
    }
    if (event.type === "keydown") {
      this._handleBilibiliSearch(event);
      return;
    }
    if (event.type !== "click" && event.type !== "auxclick") {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }
    if (event.type === "click" && event.button !== 0) {
      return;
    }
    if (event.type === "auxclick" && event.button !== 1) {
      return;
    }
    if (event.altKey) {
      return;
    }
    if (event.type === "click" && this._handleBilibiliSearch(event)) {
      return;
    }

    let target = event.target;
    if (!target || !target.closest) {
      return;
    }
    let link = target.closest("a[href], area[href]");
    if (!link) {
      return;
    }

    let href = link.href;
    if (!href || !/^https?:\/\//i.test(href) || link.hasAttribute("download")) {
      return;
    }
    // 验证页上的链接一律不接管：preventDefault + 从 chrome 侧重新 loadURI 会
    // 丢掉 __cf_chl_* 挑战令牌，表现就是「验证框点了也永远过不去」。
    if (/__cf_chl|_cf_chl_opt|cdn-cgi\/challenge-platform|cf-turnstile/i.test(href) ||
        this._isChallengePageNow()) {
      return;
    }
    try {
      let current = new URL(this.contentWindow.location.href);
      let destination = new URL(href);
      if (destination.hash && current.origin === destination.origin &&
          current.pathname === destination.pathname && current.search === destination.search) {
        return;
      }
    } catch (e) {}

    let targetName = String(link.getAttribute("target") || "").toLowerCase();
    let opensOutsideCurrent = !!targetName &&
      targetName !== "_self" && targetName !== "_top" && targetName !== "_parent";
    // PDF 阅读器中的链接必须新标签页打开：原地导航会把阅读器（含页数/缩放
    // 工具栏）整个替换掉。
    let inPdfViewer = this._isPdfViewerPage();
    let newTab = inPdfViewer || event.type === "auxclick" || event.ctrlKey || event.metaKey ||
      event.shiftKey || opensOutsideCurrent;
    let isPdf = this._isPdfUrl(href);
    // Let Gecko keep native referrers, user activation and navigation state.
    if (!isPdf && !newTab) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      this.sendAsyncMessage("Navigate", { url: href, pdf: isPdf, newTab, fromPdfViewer: inPdfViewer });
    } catch (e) {
      if (!newTab) {
        try {
          this.contentWindow.location.assign(href);
        } catch (e2) {}
      }
    }
  }
}
