/**
 * Zotero Built-in Browser Core Controller
 * Handles sidebar embedded mode & standalone mode
 */

(function () {
  // Navigation & History State
  let historyStack = [];
  let historyIndex = -1;
  let currentUrl = "";
  let currentTitle = "";

  // DOM Elements
  const urlInput = document.getElementById("url-input");
  const searchEngineSelect = document.getElementById("search-engine");
  const btnBack = document.getElementById("btn-back");
  const btnForward = document.getElementById("btn-forward");
  const btnReload = document.getElementById("btn-reload");
  const btnHome = document.getElementById("btn-home");
  const btnClear = document.getElementById("btn-clear");
  const btnGo = document.getElementById("btn-go");
  const btnSaveZotero = document.getElementById("btn-save-zotero");
  const btnOpenExternal = document.getElementById("btn-open-external");
  const btnToggleBookmarks = document.getElementById("btn-toggle-bookmarks");
  const bookmarksBar = document.getElementById("bookmarks-bar");
  const progressBar = document.getElementById("progress-bar");
  const webFrame = document.getElementById("web-frame");
  const welcomeView = document.getElementById("welcome-view");
  const frameFallback = document.getElementById("frame-fallback");
  const fallbackUrlText = document.getElementById("fallback-url-text");
  const btnFallbackExternal = document.getElementById("btn-fallback-external");
  const btnFallbackSave = document.getElementById("btn-fallback-save");
  const toastContainer = document.getElementById("toast-container");

  // Search Engine URL Templates
  const SEARCH_ENGINES = {
    bing: "https://www.bing.com/search?q=%s",
    google: "https://www.google.com/search?q=%s"
  };
  const SEARCH_PREF = "extensions.zotero-browser.searchEngine";

  /**
   * Resolve Zotero Global Instance across embedded sidebar & window contexts
   */
  function getZotero() {
    if (window.parent && window.parent.Zotero) {
      return window.parent.Zotero;
    }
    if (window.top && window.top.Zotero) {
      return window.top.Zotero;
    }
    if (window.arguments && window.arguments[0] && window.arguments[0].Zotero) {
      return window.arguments[0].Zotero;
    }
    if (window.opener && window.opener.Zotero) {
      return window.opener.Zotero;
    }
    if (typeof Zotero !== "undefined") {
      return Zotero;
    }
    try {
      if (typeof Components !== "undefined" && Components.classes) {
        return Components.classes["@zotero.org/zotero-service;1"]
          .getService(Components.interfaces.nsISupports)
          .wrappedJSObject.Zotero;
      }
    } catch (e) {
      console.warn("Could not obtain Zotero via XPCOM", e);
    }
    return null;
  }

  function loadSearchEngine() {
    let value = "";
    try {
      let z = getZotero();
      value = String(z && z.Prefs ? z.Prefs.get(SEARCH_PREF, true) || "" : "").trim().toLowerCase();
    } catch (e) {}
    let id = value === "bing" || value === "必应" ? "bing" :
      (value === "google" || value === "谷歌" ? "google" : "google");
    try {
      let z = getZotero();
      if (z && z.Prefs && value !== id) {
        z.Prefs.set(SEARCH_PREF, id, true);
      }
    } catch (e) {}
    return id;
  }

  function saveSearchEngine(id) {
    id = Object.prototype.hasOwnProperty.call(SEARCH_ENGINES, id) ? id : "google";
    try {
      let z = getZotero();
      if (z && z.Prefs) {
        z.Prefs.set(SEARCH_PREF, id, true);
      }
    } catch (e) {}
    return id;
  }

  /**
   * Initialize UI and events
   */
  function init() {
    searchEngineSelect.value = loadSearchEngine();
    searchEngineSelect.addEventListener("change", function () {
      searchEngineSelect.value = saveSearchEngine(searchEngineSelect.value);
    });
    // 1. Attach Event Listeners
    const homeSearch = document.getElementById("home-search");
    const homeSearchInput = document.getElementById("home-search-input");
    homeSearch.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!homeSearchInput.value.trim()) return;
      urlInput.value = homeSearchInput.value;
      navigateToInput();
    });
    homeSearchInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && (event.isComposing || event.keyCode === 229)) event.preventDefault();
    });
    urlInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        navigateToInput();
      }
    });

    urlInput.addEventListener("input", function () {
      btnClear.style.display = urlInput.value ? "block" : "none";
    });

    btnClear.addEventListener("click", function () {
      urlInput.value = "";
      urlInput.focus();
      btnClear.style.display = "none";
    });

    btnGo.addEventListener("click", navigateToInput);

    btnBack.addEventListener("click", function () {
      if (historyIndex > 0) {
        historyIndex--;
        loadUrl(historyStack[historyIndex], false);
      }
    });

    btnForward.addEventListener("click", function () {
      if (historyIndex < historyStack.length - 1) {
        historyIndex++;
        loadUrl(historyStack[historyIndex], false);
      }
    });

    btnReload.addEventListener("click", function () {
      if (currentUrl) {
        loadUrl(currentUrl, false);
      }
    });

    btnHome.addEventListener("click", function () {
      showWelcome();
    });

    btnToggleBookmarks.addEventListener("click", function () {
      let isHidden = bookmarksBar.style.display === "none";
      bookmarksBar.style.display = isHidden ? "flex" : "none";
    });

    // Bookmark items click
    document.querySelectorAll(".bookmark-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        let url = this.getAttribute("data-url");
        if (url) {
          loadUrl(url, true);
        }
      });
    });

    // Quick tiles on welcome view click
    document.querySelectorAll(".quick-tile").forEach(function (tile) {
      tile.addEventListener("click", function () {
        let url = this.getAttribute("data-url");
        if (url) {
          loadUrl(url, true);
        }
      });
    });

    // Save to Zotero
    btnSaveZotero.addEventListener("click", saveCurrentPageToZotero);
    btnFallbackSave.addEventListener("click", saveCurrentPageToZotero);

    // Open External
    btnOpenExternal.addEventListener("click", openInExternalBrowser);
    btnFallbackExternal.addEventListener("click", openInExternalBrowser);

    // Iframe Load handlers
    webFrame.addEventListener("load", onFrameLoad);

    // Keyboard Shortcuts inside browser view
    window.addEventListener("keydown", function (e) {
      // Ctrl/Cmd + L to focus address bar
      if ((e.ctrlKey || e.metaKey) && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        urlInput.focus();
        urlInput.select();
      }
      // Alt + Left for back
      if (e.altKey && e.key === "ArrowLeft" && !btnBack.disabled) {
        btnBack.click();
      }
      // Alt + Right for forward
      if (e.altKey && e.key === "ArrowRight" && !btnForward.disabled) {
        btnForward.click();
      }
    });

    // Check if initial URL passed
    let initialUrl = "";
    if (window.arguments && window.arguments[0] && window.arguments[0].initialUrl) {
      initialUrl = window.arguments[0].initialUrl;
    }
    if (initialUrl && initialUrl !== "about:blank") {
      loadUrl(initialUrl, true);
    } else {
      showWelcome();
    }
  }

  /**
   * Show Welcome / Quick Portal View
   */
  function showWelcome() {
    welcomeView.style.display = "flex";
    urlInput.value = "";
    btnClear.style.display = "none";
    currentUrl = "";
    currentTitle = "Zotero 学术浏览器";
    document.title = currentTitle;
    webFrame.src = "about:blank";
    stopLoading();
  }

  /**
   * Parse user input from Omnibar (URL vs Search Query)
   */
  function navigateToInput() {
    let input = urlInput.value.trim();
    if (!input) return;

    let targetUrl = "";
    const urlPattern = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i;
    const localhostPattern = /^(https?:\/\/)?localhost(:\d+)?(\/.*)?$/i;

    if (input.startsWith("http://") || input.startsWith("https://") || input.startsWith("file://")) {
      targetUrl = input;
    } else if (urlPattern.test(input) || localhostPattern.test(input)) {
      targetUrl = "https://" + input;
    } else {
      // Treat as search query
      let engine = searchEngineSelect.value || "google";
      let template = SEARCH_ENGINES[engine] || SEARCH_ENGINES.google;
      targetUrl = template.replace("%s", encodeURIComponent(input));
    }

    loadUrl(targetUrl, true);
  }

  /**
   * Load target URL into iframe with history tracking
   */
  function loadUrl(url, pushHistory = true) {
    if (!url) return;
    currentUrl = url;
    urlInput.value = url;
    btnClear.style.display = "block";

    // Hide welcome view & fallback error card
    welcomeView.style.display = "none";
    frameFallback.style.display = "none";

    // Update History Stack
    if (pushHistory) {
      if (historyIndex < historyStack.length - 1) {
        historyStack = historyStack.slice(0, historyIndex + 1);
      }
      historyStack.push(url);
      historyIndex = historyStack.length - 1;
    }

    updateNavButtons();
    startLoading();

    try {
      webFrame.src = url;
    } catch (e) {
      showFallbackCard(url);
    }
  }

  /**
   * Update Back and Forward button disabled states
   */
  function updateNavButtons() {
    btnBack.disabled = historyIndex <= 0;
    btnForward.disabled = historyIndex >= historyStack.length - 1;
  }

  /**
   * Loading animations
   */
  let progressTimeout = null;
  function startLoading() {
    progressBar.classList.remove("done");
    progressBar.classList.add("loading");

    if (progressTimeout) clearTimeout(progressTimeout);
    progressTimeout = setTimeout(function () {
      stopLoading();
    }, 4000);
  }

  function stopLoading() {
    if (progressTimeout) clearTimeout(progressTimeout);
    progressBar.classList.remove("loading");
    progressBar.classList.add("done");
  }

  function onFrameLoad() {
    stopLoading();
    try {
      if (webFrame.contentDocument) {
        currentTitle = webFrame.contentDocument.title || currentUrl;
        document.title = `${currentTitle} - Zotero 内置浏览器`;
      }
    } catch (e) {
      currentTitle = currentUrl;
    }
  }

  /**
   * Show fallback card when iframe embedding is blocked
   */
  function showFallbackCard(url) {
    stopLoading();
    fallbackUrlText.textContent = url;
    frameFallback.style.display = "flex";
  }

  /**
   * Save current browsing page/paper to Zotero library
   */
  async function saveCurrentPageToZotero() {
    const zotero = getZotero();
    if (!zotero) {
      showToast("❌ 未能连接到 Zotero 实例，无法保存条目", "error");
      return;
    }

    try {
      showToast("⏳ 正在保存到 Zotero 资料库...", "info");

      // Extract metadata
      let title = currentTitle || currentUrl || "在线文献网页";
      let url = currentUrl || urlInput.value.trim();
      if (!url) {
        showToast("⚠️ 请先打开网页再保存", "error");
        return;
      }
      let nowStr = new Date().toISOString().replace("T", " ").substring(0, 19);

      // Create new 'webpage' item
      let item = new zotero.Item("webpage");
      item.setField("title", title);
      item.setField("url", url);
      item.setField("accessDate", nowStr);

      // Add to currently selected collection if available
      let pane = zotero.getActiveZoteroPane ? zotero.getActiveZoteroPane() : null;
      if (pane && pane.getSelectedCollection) {
        let collection = pane.getSelectedCollection();
        if (collection) {
          item.addToCollection(collection.id);
        }
      }

      await item.saveTx();

      showToast(`✅ 已保存：「${title.length > 20 ? title.substring(0, 20) + '...' : title}」`, "success");
    } catch (err) {
      console.error("[Zotero Browser] Save item error:", err);
      showToast("❌ 保存条目失败: " + err.message, "error");
    }
  }

  /**
   * Open in default system browser
   */
  function openInExternalBrowser() {
    let url = currentUrl || urlInput.value.trim();
    if (!url) return;

    const zotero = getZotero();
    if (zotero && zotero.launchURL) {
      zotero.launchURL(url);
    } else {
      window.open(url, "_blank");
    }
    showToast("🌐 已在系统默认浏览器中打开", "info");
  }

  /**
   * Toast notification helper
   */
  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("show");
    }, 10);

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3500);
  }

  // Start initialization on DOM Ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
