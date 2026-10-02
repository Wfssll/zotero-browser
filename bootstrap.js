/* eslint-disable no-unused-vars */
/**
 * Zotero Built-in Sidebar Browser Plugin
 * Native Gecko browser with an in-place, non-importing online PDF.js preview.
 */

var chromeHandle;
var pluginRootURI;
var pluginID;
var sectionRegistered = false;
var resourceRegistered = false;
var actorRegistered = false;
var windowWatcherRegistered = false;
var zbSandbox = typeof globalThis !== "undefined" ? globalThis : this;
var zbVocabularyService = null;
var zbCitationService = null;
var zbCiteSectionRegistered = false;
var zbCitePopups = new Map();
var zbBackgroundService = null;

// The dock is owned by a Zotero main-window document.  Keep its lifecycle
// state outside the ItemPane section: ItemPane sections are intentionally
// rebuilt when the selected item changes, while this state (and the browser
// docshells it owns) must survive those renders.
var zbDockStates = new Map();

function zbIsPdfUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }
  if (/^(chrome|resource|about|blob|data|javascript):/i.test(url)) {
    return false;
  }
  if (/arxiv\.org\/pdf\//i.test(url) || /export\.arxiv\.org\/pdf\//i.test(url)) {
    return true;
  }
  return /\.pdf(?:$|[?#])/i.test(url);
}

function zbIsInternalPdfChannel(channel) {
  try {
    return channel.getRequestHeader("X-Zotero-Browser-Internal") === "1";
  } catch (e) {
    return false;
  }
}

function zbCopyToLocalBuffer(src) {
  if (!src) {
    throw new Error("empty PDF data");
  }
  let n = 0;
  try {
    if (typeof src.byteLength === "number") {
      n = src.byteLength;
    } else if (typeof src.length === "number") {
      n = src.length;
    }
  } catch (e) {}
  if (!n) {
    throw new Error("empty PDF data");
  }
  let local = new Uint8Array(n);
  try {
    if (typeof src.BYTES_PER_ELEMENT === "number") {
      for (let i = 0; i < n; i++) {
        local[i] = src[i] & 0xff;
      }
      return local.buffer;
    }
  } catch (e) {}
  try {
    let view = new Uint8Array(src.buffer && src.byteLength !== src.buffer.byteLength ? src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength) : src);
    n = Math.min(n, view.length);
    for (let i = 0; i < n; i++) {
      local[i] = view[i];
    }
    return local.buffer;
  } catch (e) {}
  for (let i = 0; i < n; i++) {
    local[i] = src[i] & 0xff;
  }
  return local.buffer;
}

/**
 * Fetch PDF bytes with a system-principal channel that is never a sidebar
 * top-level document load, then copy into this sandbox's ArrayBuffer.
 */
async function zbFetchPdfBuffer(url) {
  let NetUtil;
  try {
    ({ NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs"));
  } catch (e) {
    try {
      ({ NetUtil } = ChromeUtils.import("resource://gre/modules/NetUtil.jsm"));
    } catch (e2) {
      throw new Error("NetUtil unavailable");
    }
  }

  return await new Promise((resolve, reject) => {
    try {
      let uri = Services.io.newURI(url);
      let channel;
      try {
        channel = NetUtil.newChannel({
          uri,
          loadUsingSystemPrincipal: true,
          securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
          contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER
        });
      } catch (e1) {
        try {
          channel = NetUtil.newChannel({
            uri,
            loadUsingSystemPrincipal: true,
            contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER
          });
        } catch (e2) {
          channel = NetUtil.newChannel({
            uri,
            loadUsingSystemPrincipal: true
          });
        }
      }
      try {
        channel.loadFlags |= Ci.nsIChannel.LOAD_BYPASS_CACHE;
      } catch (e) {}
      try {
        let http = channel.QueryInterface(Ci.nsIHttpChannel);
        http.setRequestHeader("X-Zotero-Browser-Internal", "1", false);
        http.setRequestHeader("Accept", "application/pdf,*/*", false);
      } catch (e) {}
      NetUtil.asyncFetch(channel, (inputStream, status, request) => {
        if (!Components.isSuccessCode(status)) {
          reject(new Error("netutil:" + status.toString(16)));
          return;
        }
        try {
          let count = 0;
          try {
            count = inputStream.available();
          } catch (e) {}
          if (!count && request) {
            try {
              count = request.QueryInterface(Ci.nsIChannel).contentLength;
            } catch (e) {}
          }
          if (count > 0 && typeof NetUtil.readInputStream === "function") {
            try {
              let buf = NetUtil.readInputStream(inputStream, count);
              resolve(zbCopyToLocalBuffer(buf));
              return;
            } catch (e) {}
          }
          let bis = Components.classes["@mozilla.org/binaryinputstream;1"]
            .createInstance(Components.interfaces.nsIBinaryInputStream);
          bis.setInputStream(inputStream);
          let chunks = [];
          let total = 0;
          while (true) {
            let avail = 0;
            try {
              avail = bis.available();
            } catch (e) {
              break;
            }
            if (!avail) {
              break;
            }
            let take = Math.min(avail, 1024 * 1024);
            let piece = new ArrayBuffer(take);
            let read = 0;
            try {
              read = bis.readArrayBuffer(take, piece);
            } catch (e) {
              let str = bis.readBytes(take);
              let u8 = new Uint8Array(str.length);
              for (let i = 0; i < str.length; i++) {
                u8[i] = str.charCodeAt(i) & 0xff;
              }
              chunks.push(u8);
              total += u8.length;
              continue;
            }
            let n = read || take;
            let view = new Uint8Array(n);
            let srcView = new Uint8Array(piece, 0, n);
            for (let i = 0; i < n; i++) {
              view[i] = srcView[i];
            }
            chunks.push(view);
            total += n;
          }
          try {
            bis.close();
          } catch (e) {}
          if (total < 5) {
            reject(new Error("empty body"));
            return;
          }
          let out = new Uint8Array(total);
          let off = 0;
          for (let c of chunks) {
            for (let i = 0; i < c.length; i++) {
              out[off + i] = c[i];
            }
            off += c.length;
          }
          resolve(out.buffer);
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

var BrowserHub = {
  browsers: [],
  pdfIntent: null,

  register(inst) {
    if (!inst) {
      return null;
    }
    let doc = inst.ownerDocument || (inst.wrapper && inst.wrapper.ownerDocument);
    if (!this.browsers.includes(inst)) {
      this.browsers.push(inst);
    }
    return inst;
  },

  prune() {
    this.browsers = this.browsers.filter(inst => {
      if (!inst || !inst.wrapper) {
        return false;
      }
      let doc = inst.ownerDocument || inst.wrapper.ownerDocument;
      let win = doc && doc.defaultView;
      if (!(doc && win && !win.closed)) {
        return false;
      }
      return !!inst.wrapper.isConnected;
    });
  },

  forgetDocument(doc) {
    this.browsers = this.browsers.filter(inst => {
      let instDoc = inst && (inst.ownerDocument || (inst.wrapper && inst.wrapper.ownerDocument));
      return instDoc !== doc;
    });
  },

  notePdfIntent(url) {
    this.pdfIntent = { url, at: Date.now() };
  },

  hasRecentPdfIntent(url) {
    if (!this.pdfIntent || (Date.now() - this.pdfIntent.at) > 4000) {
      return false;
    }
    if (!url) {
      return true;
    }
    return url === this.pdfIntent.url || zbIsPdfUrl(url);
  },

  _instanceBrowsers(inst) {
    let list = [];
    try {
      if (typeof inst.getBrowsers === "function") {
        list = inst.getBrowsers() || [];
      }
    } catch (e) {}
    if (!list.length && inst.browser) {
      list = [inst.browser];
    }
    return list.filter(Boolean);
  },

  findByChannel(channel) {
    try {
      if (zbIsInternalPdfChannel(channel)) {
        return null;
      }
      let li = channel.loadInfo;
      let bc = li && li.browsingContext;
      if (!bc) {
        return null;
      }
      let top = bc.top || bc;
      let embedder = null;
      try {
        embedder = top.embedderElement;
      } catch (e) {}
      this.prune();
      for (let inst of this.browsers) {
        let browsers = this._instanceBrowsers(inst);
        for (let b of browsers) {
          if (embedder && embedder === b) {
            inst._channelBrowser = b;
            return inst;
          }
          try {
            if (b.browsingContext && (b.browsingContext === top || b.browsingContext === bc)) {
              inst._channelBrowser = b;
              return inst;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  },

  findByBrowsingContext(bc) {
    if (!bc) {
      return null;
    }
    this.prune();
    try {
      let top = bc.top || bc;
      let embedder = null;
      try {
        embedder = top.embedderElement;
      } catch (e) {}
      for (let inst of this.browsers) {
        let browsers = this._instanceBrowsers(inst);
        for (let b of browsers) {
          if (embedder && embedder === b) {
            inst._channelBrowser = b;
            return inst;
          }
          try {
            let bbc = b.browsingContext;
            if (bbc && (bbc === top || bbc === bc)) {
              inst._channelBrowser = b;
              return inst;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  },

  findByBrowser(browser) {
    if (!browser) {
      return null;
    }
    this.prune();
    for (let inst of this.browsers) {
      if (this._instanceBrowsers(inst).includes(browser)) {
        return inst;
      }
    }
    return null;
  }
};

function installPopupRouter(win) {
  if (!win || win._zoteroBrowserPopupRouter) {
    return;
  }
  let previous = null;
  try {
    previous = win.browserDOMWindow || null;
  } catch (e) {}

  function findInstance(openWindowInfo, openerBrowser) {
    let bc = null;
    try {
      bc = openWindowInfo && openWindowInfo.parent;
    } catch (e) {}
    if (!bc && openerBrowser) {
      try {
        bc = openerBrowser.browsingContext;
      } catch (e) {}
    }
    return BrowserHub.findByBrowsingContext(bc) || BrowserHub.findByBrowser(openerBrowser);
  }

  function openPluginTab(inst, uri, title) {
    if (!inst || typeof inst.addTab !== "function") {
      return null;
    }
    let url = "about:blank";
    try {
      url = uri && uri.spec ? uri.spec : url;
    } catch (e) {}
    try {
      return inst.addTab(url, {
        showHome: false,
        title: title || (url === "about:blank" ? "请稍候…" : "新标签页"),
        popup: true
      });
    } catch (e) {
      dump("[Zotero Browser] popup tab error: " + e + "\n");
      return null;
    }
  }

  function delegate(name, args) {
    try {
      if (previous && typeof previous[name] === "function") {
        return previous[name](...args);
      }
    } catch (e) {}
    return null;
  }

  let router = {
    QueryInterface: ChromeUtils.generateQI(["nsIBrowserDOMWindow"]),

    createContentWindow(aURI, aOpenWindowInfo, aWhere, aFlags, aTriggeringPrincipal, aCsp) {
      let inst = findInstance(aOpenWindowInfo, null);
      if (!inst) {
        return delegate("createContentWindow", arguments);
      }
      let tab = openPluginTab(inst, aURI, "请稍候…");
      return tab && tab.browser && tab.browser.browsingContext;
    },

    openURI(aURI, aOpenWindowInfo, aWhere, aFlags, aTriggeringPrincipal, aCsp) {
      let inst = findInstance(aOpenWindowInfo, null);
      if (!inst) {
        return delegate("openURI", arguments);
      }
      let tab = openPluginTab(inst, aURI);
      return tab && tab.browser && tab.browser.browsingContext;
    },

    createContentWindowInFrame(aURI, aParams, aWhere, aFlags, aName) {
      let openInfo = aParams && aParams.openWindowInfo;
      let openerBrowser = aParams && aParams.openerBrowser;
      let inst = findInstance(openInfo, openerBrowser);
      if (!inst) {
        return delegate("createContentWindowInFrame", arguments);
      }
      let tab = openPluginTab(inst, aURI, aName || "请稍候…");
      return tab && tab.browser;
    },

    openURIInFrame(aURI, aParams, aWhere, aFlags, aName) {
      let openInfo = aParams && aParams.openWindowInfo;
      let openerBrowser = aParams && aParams.openerBrowser;
      let inst = findInstance(openInfo, openerBrowser);
      if (!inst) {
        return delegate("openURIInFrame", arguments);
      }
      let tab = openPluginTab(inst, aURI, aName);
      return tab && tab.browser;
    },

    canClose() {
      return previous && typeof previous.canClose === "function"
        ? previous.canClose()
        : true;
    },

    get tabCount() {
      if (previous && typeof previous.tabCount === "number") {
        return previous.tabCount;
      }
      return BrowserHub.browsers.reduce((sum, inst) => {
        try {
          return sum + (inst.getBrowsers ? inst.getBrowsers().length : 0);
        } catch (e) {
          return sum;
        }
      }, 0);
    }
  };

  try {
    win._zoteroBrowserPreviousBrowserDOMWindow = previous;
    win._zoteroBrowserPopupRouter = router;
    win.browserDOMWindow = router;
  } catch (e) {
    delete win._zoteroBrowserPopupRouter;
    dump("[Zotero Browser] popup router install error: " + e + "\n");
  }
}

function uninstallPopupRouter(win) {
  if (!win || !win._zoteroBrowserPopupRouter) {
    return;
  }
  try {
    if (win.browserDOMWindow === win._zoteroBrowserPopupRouter) {
      win.browserDOMWindow = win._zoteroBrowserPreviousBrowserDOMWindow || null;
    }
  } catch (e) {}
  delete win._zoteroBrowserPopupRouter;
  delete win._zoteroBrowserPreviousBrowserDOMWindow;
}

/**
 * Only intercepts HTTP from this plugin's sidebar <browser>.
 * Never touches Zotero sync / Attachments.importFromURL / HiddenBrowser.
 */
var httpResponseObserver = {
  observe(subject, topic) {
    let channel;
    try {
      channel = subject.QueryInterface(Ci.nsIHttpChannel);
    } catch (e) {
      return;
    }

    try {
      if (zbIsInternalPdfChannel(channel)) {
        return;
      }
    } catch (e) {}

    let inst = BrowserHub.findByChannel(channel);
    if (!inst) {
      return;
    }

    // Preserve the host engine's User-Agent and request headers.

    let isDocument = false;
    try {
      let li = channel.loadInfo;
      isDocument = !!(li && li.isTopLevelLoad);
      if (isDocument && li.externalContentPolicyType) {
        isDocument = li.externalContentPolicyType === Ci.nsIContentPolicy.TYPE_DOCUMENT;
      }
    } catch (e) {}
    if (!isDocument) {
      return;
    }

    let url = "";
    try {
      url = channel.URI.spec;
    } catch (e) {
      return;
    }

    if (topic === "http-on-modify-request") {
      if (zbIsPdfUrl(url)) {
        BrowserHub.notePdfIntent(url);
        try {
          channel.cancel(Components.results.NS_BINDING_ABORTED);
        } catch (e) {}
        if (inst._channelBrowser && inst._channelBrowser !== inst.browser && typeof inst.activateBrowser === "function") {
          try {
            inst.activateBrowser(inst._channelBrowser);
          } catch (e) {}
        }
        inst.openPdf(url);
      }
      return;
    }

    if (topic === "http-on-examine-response" || topic === "http-on-examine-cached-response") {
      let contentType = "";
      try {
        contentType = (channel.contentType || "").toLowerCase();
      } catch (e) {}
      let disposition = "";
      try {
        disposition = channel.getResponseHeader("content-disposition") || "";
      } catch (e) {}

      let looksPdf = zbIsPdfUrl(url) ||
        contentType === "application/pdf" ||
        contentType === "application/x-pdf" ||
        /filename\*?=.*\.pdf/i.test(disposition);

      if (looksPdf) {
        BrowserHub.notePdfIntent(url);
        try {
          channel.cancel(Components.results.NS_BINDING_ABORTED);
        } catch (e) {}
        if (inst._channelBrowser && inst._channelBrowser !== inst.browser && typeof inst.activateBrowser === "function") {
          try {
            inst.activateBrowser(inst._channelBrowser);
          } catch (e) {}
        }
        inst.openPdf(url);
      }
    }
  }
};

var helperAppWindowObserver = {
  observe(subject, topic) {
    if (topic !== "domwindowopened" || !subject) {
      return;
    }
    let win = subject;
    win.addEventListener("DOMContentLoaded", function () {
      let uri = "";
      try {
        uri = win.document.documentURI || win.location.href || "";
      } catch (e) {
        return;
      }
      if (!uri.includes("unknownContentType")) {
        return;
      }

      let sourceUrl = "";
      try {
        let dlg = win.wrappedJSObject && win.wrappedJSObject.dialog;
        let launcher = dlg && dlg.mLauncher;
        if (launcher && launcher.source) {
          sourceUrl = launcher.source.spec;
        }
      } catch (e) {}

      if (!BrowserHub.hasRecentPdfIntent(sourceUrl)) {
        return;
      }

      try {
        let dlg = win.wrappedJSObject && win.wrappedJSObject.dialog;
        if (dlg && dlg.mLauncher && dlg.mLauncher.cancel) {
          dlg.mLauncher.cancel(Components.results.NS_BINDING_ABORTED);
        }
      } catch (e) {}
      try {
        win.close();
      } catch (e) {}

      BrowserHub.prune();
      let inst = BrowserHub.browsers[BrowserHub.browsers.length - 1];
      let pdfUrl = sourceUrl || (BrowserHub.pdfIntent && BrowserHub.pdfIntent.url);
      if (inst && inst.openPdf && pdfUrl) {
        inst.openPdf(pdfUrl);
      }
    }, { once: true });
  }
};

function registerResourceSubstitution() {
  if (resourceRegistered || !pluginRootURI) {
    return;
  }
  try {
    let proto = Services.io.getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler);
    proto.setSubstitution("zotero-browser", Services.io.newURI(pluginRootURI));
    resourceRegistered = true;
  } catch (e) {
    dump("[Zotero Browser] resource substitution error: " + e + "\n");
  }
}

function unregisterResourceSubstitution() {
  if (!resourceRegistered) {
    return;
  }
  try {
    let proto = Services.io.getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler);
    proto.setSubstitution("zotero-browser", null);
  } catch (e) {}
  resourceRegistered = false;
}

function registerEmbedActor() {
  if (actorRegistered) {
    return;
  }
  let options = {
    parent: {
      esModuleURI: "resource://zotero-browser/content/actors/ZoteroBrowserEmbedParent.sys.mjs"
    },
    child: {
      esModuleURI: "resource://zotero-browser/content/actors/ZoteroBrowserEmbedChild.sys.mjs",
      events: {
        click: { capture: true, wantUntrusted: true },
        auxclick: { capture: true, wantUntrusted: true },
        keydown: { capture: true, wantUntrusted: true },
        mouseup: { capture: true, wantUntrusted: true },
        DOMContentLoaded: { capture: true }
      }
    },
    allFrames: true,
    includeChrome: false,
    // 不设 matches：内置 PDF 阅读器是 resource:// 页面，http/https 的
    // MatchPattern 覆盖不到它；messageManagerGroups 已把作用域限制在
    // 本插件的 browser 元素内。
    messageManagerGroups: ["zotero-browser"],
    // Leave third-party verification frames outside the plugin's navigation bridge.
    excludeMatches: [
      "*://challenges.cloudflare.com/*",
      "*://*.cloudflare.com/cdn-cgi/*",
      "*://*.hcaptcha.com/*",
      "*://*.recaptcha.net/*",
      "*://www.google.com/recaptcha/*",
      "*://*.geetest.com/*",
      "*://*.arkoselabs.com/*"
    ]
  };
  try {
    ChromeUtils.registerWindowActor("ZoteroBrowserEmbed", options);
    actorRegistered = true;
  } catch (e) {
    dump("[Zotero Browser] registerWindowActor with excludeMatches failed, retrying without it: " + e + "\n");
    try {
      delete options.excludeMatches;
      ChromeUtils.registerWindowActor("ZoteroBrowserEmbed", options);
      actorRegistered = true;
    } catch (e2) {
      dump("[Zotero Browser] registerWindowActor note: " + e2 + "\n");
    }
  }
}

function unregisterEmbedActor() {
  if (!actorRegistered) {
    return;
  }
  try {
    ChromeUtils.unregisterWindowActor("ZoteroBrowserEmbed");
  } catch (e) {}
  actorRegistered = false;
}

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  pluginID = id;
  if (!rootURI) {
    rootURI = resourceURI ? resourceURI.spec : "";
  }
  pluginRootURI = rootURI;

  try {
    var aomStartup = Components.classes[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Components.interfaces.amIAddonManagerStartup);
    var manifestURI = Services.io.newURI(rootURI + "manifest.json");
    chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "zotero-browser", rootURI + "content/"],
      ["locale", "zotero-browser", "en-US", rootURI + "locale/en-US/"],
      ["locale", "zotero-browser", "zh-CN", rootURI + "locale/zh-CN/"],
    ]);
  } catch (e) {
    dump("[Zotero Browser] registerChrome error: " + e + "\n");
  }

  registerResourceSubstitution();
  loadSidebarScript();
  if (zbVocabularyService) zbVocabularyService.registerReader(pluginID);

  try {
    Services.obs.addObserver(httpResponseObserver, "http-on-modify-request", false);
    Services.obs.addObserver(httpResponseObserver, "http-on-examine-response", false);
    Services.obs.addObserver(httpResponseObserver, "http-on-examine-cached-response", false);
  } catch (e) {}

  try {
    Services.ww.registerNotification(helperAppWindowObserver);
    windowWatcherRegistered = true;
  } catch (e) {}

  registerSidebarSection();
  registerCiteSection();
  registerReaderToolbarButton();
  registerReaderTabObserver();

  let windows = getZoteroWindows();
  for (let win of windows) {
    addToWindow(win);
  }
}

function registerSidebarSection() {
  if (typeof Zotero === "undefined" || !Zotero.ItemPaneManager || sectionRegistered) {
    return;
  }

  try {
    Zotero.ItemPaneManager.registerSection({
      paneID: "zotero-browser-pane",
      pluginID: pluginID,
      header: {
        l10nID: "zotero-browser-pane-header",
        icon: "chrome://zotero-browser/content/icons/icon-16.png"
      },
      sidenav: {
        l10nID: "zotero-browser-pane-sidenav",
        icon: "chrome://zotero-browser/content/icons/icon-20.png"
      },
      onInit: ({ paneID, doc, body }) => {},
      onDestroy: ({ paneID, doc, body }) => {
        BrowserHub.prune();
      },
      onItemChange: ({ paneID, doc, body, item, tabType, editable, setEnabled }) => {
        if (setEnabled) setEnabled(true);
      },
      onRender: ({ doc, body, item }) => {
        // ItemPane bodies are ephemeral and are re-rendered for every item.
        // Keep this section as a tiny launcher; the real browser is mounted in
        // the window-level dock and therefore keeps its tabs and docshells.
        renderSidebarDockLauncher(doc, body);
      }
    });
    sectionRegistered = true;
  } catch (err) {
    dump("[Zotero Browser] Error registering sidebar section: " + err + "\n");
  }
}

function zbCiteGetToken() {
  return Services.logins.findLogins("https://api.adsabs.harvard.edu", null, "Zotero Browser Cite")
    .find(login => login.username === "ADS API")?.password || "";
}

async function zbCiteSetToken(token) {
  for (const login of Services.logins.findLogins("https://api.adsabs.harvard.edu", null, "Zotero Browser Cite")) {
    if (login.username === "ADS API") Services.logins.removeLogin(login);
  }
  if (token) {
    const login = Components.classes["@mozilla.org/login-manager/loginInfo;1"].createInstance(Components.interfaces.nsILoginInfo);
    login.init("https://api.adsabs.harvard.edu", null, "Zotero Browser Cite", "ADS API", token, "", "");
    await Services.logins.addLoginAsync(login);
  }
}

function zbCiteOptions(doc, getSource) {
  return {
    getSource,
    getPane: () => Zotero.getActiveZoteroPane(),
    sourceFromInput: value => {
      const pane = Zotero.getActiveZoteroPane();
      const collection = pane.getSelectedCollection();
      return zbCitation.sourceFromURL(value, pane.getSelectedLibraryID(), collection ? [collection.id] : []);
    },
    openURL: url => Zotero.launchURL(url),
    copy: text => {
      Components.classes["@mozilla.org/widget/clipboardhelper;1"].getService(Components.interfaces.nsIClipboardHelper).copyString(text);
    },
    exportFile: async text => {
      const picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
      picker.init(doc.defaultView.browsingContext, "保存 ADS BibTeX", Components.interfaces.nsIFilePicker.modeSave);
      picker.defaultString = "ads-citations.bib"; picker.defaultExtension = "bib";
      picker.appendFilter("BibTeX", "*.bib");
      const result = await new Promise(resolve => picker.open(resolve));
      if (result === Components.interfaces.nsIFilePicker.returnOK || result === Components.interfaces.nsIFilePicker.returnReplace) {
        await Zotero.File.putContentsAsync(picker.file.path, text);
      }
    },
    hasToken: () => !!zbCiteGetToken(), setToken: zbCiteSetToken,
    getAutoCopy: () => Zotero.Prefs.get("extensions.zotero-browser.citeAutoCopy", true) === true,
    setAutoCopy: value => Zotero.Prefs.set("extensions.zotero-browser.citeAutoCopy", value, true)
  };
}

function registerCiteSection() {
  if (zbCiteSectionRegistered || !zbCitationService || !Zotero.ItemPaneManager) return;
  Zotero.ItemPaneManager.registerSection({
    paneID: "zotero-browser-cite", pluginID,
    header: { l10nID: "zotero-browser-cite-header", icon: "chrome://zotero-browser/content/icons/cite.svg" },
    sidenav: { l10nID: "zotero-browser-cite-sidenav", icon: "chrome://zotero-browser/content/icons/cite.svg" },
    onItemChange: ({ item, setEnabled }) => {
      setEnabled(!!item && (item.isRegularItem() || (item.isAttachment() && item.parentID)));
    },
    onRender: ({ doc, body, item }) => {
      body.textContent = "";
      const button = doc.createElement("button");
      button.type = "button"; button.textContent = "打开 Cite · ADS BibTeX";
      button.style.cssText = "margin:8px;padding:6px 10px;font:inherit;cursor:pointer;color:var(--fill-primary,#212529);background:var(--material-background,#f3f4f6);border:1px solid var(--material-border,#d1d5db);border-radius:4px;";
      button.addEventListener("click", () => zbOpenCite(doc.defaultView, item));
      body.appendChild(button);
    },
    onDestroy: () => {}
  });
  zbCiteSectionRegistered = true;
}

function zbOpenCite(win, item) {
  win = win || Zotero.getMainWindow();
  item = item || zbCiteCurrentItem(win);
  zbShowCitePopup(win, item ? zbCitationService.itemSource(item) : null, "zotero");
}

function zbCiteCurrentItem(win) {
  const tabID = win.Zotero_Tabs?.selectedID;
  if (tabID) {
    const reader = Zotero.Reader.getByTabID(tabID);
    if (reader) return Zotero.Items.get(reader.itemID);
  } else {
    const reader = Zotero.Reader._readers?.find(reader => reader._window === win);
    if (reader) return Zotero.Items.get(reader.itemID);
  }
  const pane = win.ZoteroPane || Zotero.getActiveZoteroPane();
  return pane?.getSelectedItems()[0] || null;
}

async function zbResolveLocalPDF(item) {
  if (!item) throw new Error("请先打开一篇 PDF，或在资料库中选中一篇文章");
  const attachments = item.isAttachment() ? [item] : item.isRegularItem() ? await item.getBestAttachments() : [];
  const pdfs = attachments.filter(attachment => attachment.isPDFAttachment());
  if (!pdfs.length) throw new Error("当前条目没有 PDF 附件");
  for (const attachment of pdfs) {
    const path = await attachment.getFilePathAsync();
    if (path) return path;
  }
  throw new Error("PDF 文件尚未保存在本地或已经丢失，请先下载或定位文件");
}

function zbWritePDFClipboard(path) {
  const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
  file.initWithPath(path);
  if (!file.exists() || !file.isFile()) throw new Error("本地 PDF 文件不存在，请重新定位文件");
  const transferable = Components.classes["@mozilla.org/widget/transferable;1"].createInstance(Components.interfaces.nsITransferable);
  transferable.init(null);
  transferable.addDataFlavor("application/x-moz-file");
  transferable.setTransferData("application/x-moz-file", file);
  const clipboard = Components.classes["@mozilla.org/widget/clipboard;1"].getService(Components.interfaces.nsIClipboard);
  clipboard.setData(transferable, null, Components.interfaces.nsIClipboard.kGlobalClipboard);
}

async function zbCopyPDFFile(win, item) {
  win = win || Zotero.getMainWindow();
  try {
    // Capture the item before awaiting file lookup, so switching tabs cannot
    // change which paper is copied by this click.
    const path = await zbResolveLocalPDF(item || zbCiteCurrentItem(win));
    zbWritePDFClipboard(path);
    const progress = new Zotero.ProgressWindow({ window: win });
    progress.changeHeadline("已复制 PDF 文件");
    progress.addDescription("可以在支持文件粘贴的聊天窗口或文件夹中粘贴。");
    progress.show();
    progress.startCloseTimer(2500);
  } catch (error) {
    Services.prompt.alert(win, "复制 PDF", error.message || String(error));
  }
}

function zbShowCitePopup(win, source, origin, automatic = false) {
  if (!win || win.closed || !zbCitationService) return;
  let state = zbCitePopups.get(win);
  // A background browser load must not replace a citation the user opened
  // for the PDF currently being read in Zotero.
  if (automatic && state?.popup.isOpen() && state.origin !== origin) return;
  if (!state) {
    state = { source: null, origin, signature: "", popup: null, unload: null };
    const getSource = () => {
      if (state.source) return state.source;
      const item = zbCiteCurrentItem(win);
      if (item) return zbCitationService.itemSource(item);
      throw new Error("请选择一篇 Zotero 文章，或输入 arXiv／ADS 链接");
    };
    state.popup = zbCreateCitePopup(win.document, zbCitationService, zbCiteOptions(win.document, getSource));
    win.document.documentElement.appendChild(state.popup.root);
    state.unload = () => zbDisposeCitePopup(win);
    win.addEventListener("unload", state.unload, { once: true });
    zbCitePopups.set(win, state);
  }
  const signature = source ? JSON.stringify([source.libraryID, source.identity, source.arxiv, source.doi, source.bibcode, source.title]) : "";
  const changed = state.signature !== signature;
  state.source = source; state.origin = origin; state.signature = signature;
  state.popup.show();
  if (changed || !source || !automatic) state.popup.panel.setSource(source, !!source);
}

function zbCitePopupIsOpen(win, origin) {
  const state = zbCitePopups.get(win);
  return !!(state && state.origin === origin && state.popup.isOpen());
}

function zbHideCitePopup(win) {
  zbCitePopups.get(win)?.popup.hide();
}

function zbClearBrowserCiteSource(win) {
  const state = zbCitePopups.get(win);
  if (state?.origin === "browser") {
    state.source = null; state.signature = "";
    state.popup.panel.setSource(null);
  }
}

function zbDisposeCitePopup(win) {
  const state = zbCitePopups.get(win);
  if (!state) return;
  win.removeEventListener("unload", state.unload);
  state.popup.dispose(); zbCitePopups.delete(win);
}

var zbReaderToolbarHandler = null;
var zbReaderTabObserver = null;
var zbReaderTabObserverID = null;

/**
 * Inject a browser button into the PDF reader toolbar via the official
 * Zotero.Reader event API.  A reader window that is also a Zotero main
 * window uses its same-document dock; an independent reader window opens
 * the main window’s dock.
 */
function zbToolbarIcon(name, size = 18) {
  const paths = {
    browser: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    cite: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 12h2v3H8v-3m2 3c0 1-1 2-2 2m6-5h2v3h-2v-3m2 3c0 1-1 2-2 2"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/>'
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none;">${paths[name]}</svg>`;
}

function registerReaderToolbarButton() {
  if (zbReaderToolbarHandler) {
    return;
  }
  try {
    if (typeof Zotero === "undefined" || !Zotero.Reader ||
        typeof Zotero.Reader.registerEventListener !== "function") {
      return;
    }
    zbReaderToolbarHandler = (event) => {
      try {
        let { reader, doc, append } = event;
        if (!doc || typeof append !== "function") {
          return;
        }
        let readerWin = null;
        try { readerWin = reader && reader._window; } catch (e) {}
        let paperTitle = zbReaderPaperTitle(reader);
        if (readerWin) {
          zbSetDockContextTitle(readerWin, paperTitle || "内置浏览器");
        }
        let btn = doc.createElement("button");
        btn.className = "toolbar-button";
        btn.id = "zb-reader-browser-btn";
        btn.title = "折叠/展开主窗口右侧浏览器";
        btn.setAttribute("aria-label", "浏览器");
        btn.tabIndex = -1;
        btn.innerHTML = zbToolbarIcon("browser");
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          toggleRightBrowser(reader && reader._window ? reader._window : null);
        });
        const copyButton = doc.createElement("button");
        copyButton.className = "toolbar-button";
        copyButton.id = "zb-reader-copy-pdf-btn";
        copyButton.title = "复制当前论文的本地 PDF 文件";
        copyButton.setAttribute("aria-label", "复制 PDF 文件");
        copyButton.innerHTML = zbToolbarIcon("copy");
        for (const button of [copyButton, btn]) {
          button.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;padding:4px;box-sizing:border-box;border-radius:5px;";
        }
        copyButton.addEventListener("click", () => zbCopyPDFFile(reader._window, Zotero.Items.get(reader.itemID)));
        append(copyButton);
        append(btn);
        if (zbCitationService) {
          const citeButton = doc.createElement("button");
          citeButton.className = "toolbar-button";
          citeButton.id = "zb-reader-cite-btn";
          citeButton.innerHTML = zbToolbarIcon("cite");
          citeButton.setAttribute("aria-label", "Cite · ADS BibTeX");
          citeButton.style.cssText = btn.style.cssText;
          citeButton.title = "获取当前论文的 NASA ADS BibTeX";
          citeButton.addEventListener("click", () => zbOpenCite(reader._window, Zotero.Items.get(reader.itemID)));
          append(citeButton);
        }
      } catch (e) {
        dump("[Zotero Browser] reader toolbar button error: " + e + "\n");
      }
    };
    Zotero.Reader.registerEventListener("renderToolbar", zbReaderToolbarHandler, pluginID);
  } catch (e) {
    dump("[Zotero Browser] registerReaderToolbarButton error: " + e + "\n");
  }
}

function unregisterReaderToolbarButton() {
  if (!zbReaderToolbarHandler) {
    return;
  }
  try {
    if (typeof Zotero !== "undefined" && Zotero.Reader &&
        typeof Zotero.Reader.unregisterEventListener === "function") {
      Zotero.Reader.unregisterEventListener("renderToolbar", zbReaderToolbarHandler);
    }
  } catch (e) {}
  zbReaderToolbarHandler = null;
}

function zbReaderPaperTitle(reader) {
  let item = null;
  try { item = reader && reader._item; } catch (e) {}
  let parent = null;
  try {
    if (item && item.parentID && Zotero.Items && typeof Zotero.Items.get === "function") {
      parent = Zotero.Items.get(item.parentID);
    }
  } catch (e) {}
  let paper = parent || item;
  if (paper && typeof paper.getField === "function") {
    try {
      let title = String(paper.getField("title") || "").trim();
      if (title) {
        return title;
      }
    } catch (e) {}
  }
  try {
    let title = String(reader && reader._title || "").trim();
    return title;
  } catch (e) {
    return "";
  }
}

function registerReaderTabObserver() {
  if (zbReaderTabObserverID) {
    return;
  }
  try {
    if (typeof Zotero === "undefined" || !Zotero.Notifier ||
        typeof Zotero.Notifier.registerObserver !== "function" ||
        !Zotero.Reader || typeof Zotero.Reader.getByTabID !== "function") {
      return;
    }
    zbReaderTabObserver = {
      notify(event, type, ids) {
        if (type !== "tab" || event !== "select") {
          return;
        }
        let reader = null;
        try {
          let list = Array.isArray(ids) ? ids : [ids];
          for (let id of list) {
            reader = Zotero.Reader.getByTabID(id);
            if (reader) {
              break;
            }
          }
        } catch (e) {}
        if (reader) {
          let readerWin = null;
          try { readerWin = reader._window; } catch (e) {}
          let title = zbReaderPaperTitle(reader);
          if (readerWin) {
            zbSetDockContextTitle(readerWin, title || "当前文献/文档");
          }
          return;
        }
        // A library/search tab has no Reader instance.  Clear stale paper
        // context from every mounted main-window dock.
        for (let state of zbDockStates.values()) {
          zbDockApplyContextTitle(state, "内置浏览器");
        }
      }
    };
    zbReaderTabObserverID = Zotero.Notifier.registerObserver(zbReaderTabObserver, ["tab"], "zotero-browser");
  } catch (e) {
    dump("[Zotero Browser] registerReaderTabObserver error: " + e + "\n");
    zbReaderTabObserver = null;
    zbReaderTabObserverID = null;
  }
}

function unregisterReaderTabObserver() {
  if (!zbReaderTabObserverID) {
    return;
  }
  try {
    if (typeof Zotero !== "undefined" && Zotero.Notifier &&
        typeof Zotero.Notifier.unregisterObserver === "function") {
      Zotero.Notifier.unregisterObserver(zbReaderTabObserverID);
    }
  } catch (e) {}
  zbReaderTabObserver = null;
  zbReaderTabObserverID = null;
}

async function zbImportBackgroundImage(win) {
  const picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
  picker.init(win.browsingContext, "选择主页背景图片", Components.interfaces.nsIFilePicker.modeOpen);
  picker.appendFilter("背景图片（JPG、PNG、WebP）", "*.jpg;*.jpeg;*.png;*.webp");
  const result = await new Promise(resolve => picker.open(resolve));
  if (result !== Components.interfaces.nsIFilePicker.returnOK) return null;
  const file = picker.file;
  const extension = file.leafName.split(".").pop().toLowerCase();
  if (!["jpg", "jpeg", "png", "webp"].includes(extension)) throw new Error("请选择 JPG、PNG 或 WebP 图片");
  if (file.fileSize > 20 * 1024 * 1024) throw new Error("请选择小于 20 MB 的图片");
  const url = Services.io.newFileURI(file).spec;
  const image = new win.Image(); image.src = url;
  try { await image.decode(); } catch (_) { throw new Error("图片无法读取，请选择有效的图片文件"); }
  const directory = Zotero.File.pathToFile(Zotero.DataDirectory.dir); directory.append("zotero-browser-backgrounds");
  if (!directory.exists()) directory.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o700);
  const name = "custom-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) + "." + extension;
  file.copyTo(directory, name);
  directory.append(name); return directory.path;
}

function zbRemoveBackgroundImage(path) {
  const file = Zotero.File.pathToFile(path);
  const directory = Zotero.File.pathToFile(Zotero.DataDirectory.dir); directory.append("zotero-browser-backgrounds");
  // Only remove our imported copy; never remove the original chosen image.
  if (file.parent.path === directory.path && file.exists()) file.remove(false);
}

function loadSidebarScript() {
  zbSandbox.zbZoom = ChromeUtils.importESModule("resource://zotero-browser/content/zoom.sys.mjs").zbZoom;
  if (!zbBackgroundService) {
    try {
      Services.scriptloader.loadSubScript("chrome://zotero-browser/content/backgrounds.js", zbSandbox);
      zbBackgroundService = zbBackgrounds.createService({
        read: () => Zotero.Prefs.get("extensions.zotero-browser.homeBackground", true),
        write: value => Zotero.Prefs.set("extensions.zotero-browser.homeBackground", value, true),
        fileURL: path => path ? Services.io.newFileURI(Zotero.File.pathToFile(path)).spec : "",
        importImage: zbImportBackgroundImage, removeImage: zbRemoveBackgroundImage
      });
    } catch (error) { dump("[Zotero Browser] load backgrounds: " + error + "\n"); }
  }
  if (!zbCitationService) {
    try {
      Services.scriptloader.loadSubScript("chrome://zotero-browser/content/citation.js", zbSandbox);
      Services.scriptloader.loadSubScript("chrome://zotero-browser/content/cite-ui.js", zbSandbox);
      zbCitationService = zbCitation.createService(Zotero, { getToken: zbCiteGetToken });
    } catch (e) { dump("[Zotero Browser] load Cite: " + e + "\n"); }
  }
  if (!zbVocabularyService) {
    try {
      Services.scriptloader.loadSubScript("chrome://zotero-browser/content/vocabulary.js", zbSandbox);
      zbVocabularyService = zbVocabulary.createService(Zotero);
    } catch (e) {
      dump("[Zotero Browser] load vocabulary: " + e + "\n");
    }
  }
  // The Safari binary cookie parser is kept dependency-free so QA can load it
  // directly from Node.  Load it into the same bootstrap sandbox before the
  // sidebar script consumes its global API.
  if (typeof zbParseSafariBinaryCookies !== "function") {
    let parserUrls = [
      "chrome://zotero-browser/content/safari-binarycookies.js"
    ];
    if (pluginRootURI) {
      parserUrls.push(pluginRootURI + "content/safari-binarycookies.js");
    }
    for (let parserUrl of parserUrls) {
      try {
        Services.scriptloader.loadSubScript(parserUrl, zbSandbox);
        if (typeof zbParseSafariBinaryCookies === "function") {
          break;
        }
      } catch (e) {
        dump("[Zotero Browser] load Safari cookie parser " + parserUrl + ": " + e + "\n");
      }
    }
  }
  if (typeof zbInitSidebarBrowser === "function") {
    return true;
  }
  let urls = [
    "chrome://zotero-browser/content/sidebar-browser.js"
  ];
  if (pluginRootURI) {
    urls.push(pluginRootURI + "content/sidebar-browser.js");
  }
  for (let url of urls) {
    try {
      Services.scriptloader.loadSubScript(url, zbSandbox);
      if (typeof zbInitSidebarBrowser === "function") {
        return true;
      }
    } catch (e) {
      dump("[Zotero Browser] loadSubScript " + url + ": " + e + "\n");
    }
  }
  return typeof zbInitSidebarBrowser === "function";
}

function showSidebarInitError(doc, body, err) {
  try {
    if (!doc || !body) {
      return;
    }
    body.textContent = "";
    let box = doc.createElement("div");
    box.style.cssText = "padding:14px;color:#b91c1c;font-size:12px;line-height:1.5;white-space:pre-wrap;";
    box.textContent = "内置浏览器初始化失败，请重启 Zotero。\n\n" + err;
    body.appendChild(box);
  } catch (e) {}
}

function initSidebarBrowser(doc, body, options) {
  try {
    loadSidebarScript();
    if (typeof zbInitSidebarBrowser !== "function") {
      throw new Error("未能加载 sidebar-browser.js");
    }
    return zbInitSidebarBrowser(doc, body, options || { scope: "sidebar" });
  } catch (e) {
    dump("[Zotero Browser] initSidebarBrowser error: " + e + "\n" + (e && e.stack ? e.stack : "") + "\n");
    showSidebarInitError(doc, body, e);
  }
}

async function onMainWindowLoad({ window }, reason) {
  registerSidebarSection();
  registerCiteSection();
  addToWindow(window);
}

async function onMainWindowUnload({ window }, reason) {
  removeFromWindow(window);
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  try {
    Services.obs.removeObserver(httpResponseObserver, "http-on-modify-request");
    Services.obs.removeObserver(httpResponseObserver, "http-on-examine-response");
    Services.obs.removeObserver(httpResponseObserver, "http-on-examine-cached-response");
  } catch (e) {}

  if (windowWatcherRegistered) {
    try {
      Services.ww.unregisterNotification(helperAppWindowObserver);
    } catch (e) {}
    windowWatcherRegistered = false;
  }

  unregisterEmbedActor();
  unregisterResourceSubstitution();
  unregisterReaderToolbarButton();
  unregisterReaderTabObserver();
  if (zbVocabularyService) zbVocabularyService.unregisterReader();
  for (const win of Array.from(zbCitePopups.keys())) zbDisposeCitePopup(win);
  if (zbCiteSectionRegistered) {
    Zotero.ItemPaneManager.unregisterSection("zotero-browser-cite");
    zbCiteSectionRegistered = false;
  }

  if (typeof Zotero !== "undefined" && Zotero.ItemPaneManager && sectionRegistered) {
    try {
      Zotero.ItemPaneManager.unregisterSection("zotero-browser-pane");
    } catch (e) {}
    sectionRegistered = false;
  }

  let windows = getZoteroWindows();
  for (let win of windows) {
    removeFromWindow(win);
  }
  // A main window can disappear from Zotero.getMainWindows() during shutdown;
  // make sure every dock state still gets its listeners and DOM removed.
  for (let win of Array.from(zbDockStates.keys())) {
    zbDockRemoveForWindow(win);
  }

  BrowserHub.browsers = [];

  if (chromeHandle) {
    try {
      chromeHandle.destruct();
    } catch (e) {}
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}

function getZoteroWindows() {
  let windows = [];
  if (typeof Zotero !== "undefined" && Zotero.getMainWindows) {
    windows = Zotero.getMainWindows();
  } else {
    let enumerator = Services.wm.getEnumerator(null);
    while (enumerator.hasMoreElements()) {
      let win = enumerator.getNext();
      if (win.document && (win.document.getElementById("zotero-pane") || win.location.href.includes("zotero"))) {
        windows.push(win);
      }
    }
  }
  return windows;
}

/**
 * Theme palettes used by the right-side browser.
 * Keys are CSS custom properties applied to the panel / wrapper elements;
 * existing inline styles pick them up through var(--material-*, fallback).
 */
var ZB_THEMES = {
  cream: {
    label: "奶油色",
    "--material-sidepane": "#FBF8F1",
    "--material-background": "#F2EDE3",
    "--material-border": "#E2DACA",
    "--fill-primary": "#3B372E",
    "--fill-secondary": "#7A7263",
    "--accent-color": "#D97757",
    "--zb-accent-hover": "#C4613F",
    "--zb-accent-text": "#FFFFFF",
    "--zb-accent-soft": "rgba(217, 119, 87, 0.16)",
    "--zb-btn-bg": "#FFFDF8",
    "--zb-btn-hover": "#F0EADB",
    "--zb-input-bg": "#FFFDF8",
    "--zb-success": "#7D9B6A",
    "--zb-selection": "#F0DFCE"
  },
  light: {
    label: "浅灰色",
    "--material-sidepane": "#FFFFFF",
    "--material-background": "#F3F4F6",
    "--material-border": "#D1D5DB",
    "--fill-primary": "#212529",
    "--fill-secondary": "#6B7280",
    "--accent-color": "#2563EB",
    "--zb-accent-hover": "#1D4ED8",
    "--zb-accent-text": "#FFFFFF",
    "--zb-accent-soft": "rgba(37, 99, 235, 0.12)",
    "--zb-btn-bg": "#FFFFFF",
    "--zb-btn-hover": "#F3F4F6",
    "--zb-input-bg": "#FFFFFF",
    "--zb-success": "#059669",
    "--zb-selection": "#DBEAFE"
  },
  dark: {
    label: "深灰蓝",
    "--material-sidepane": "#24272F",
    "--material-background": "#1B1E25",
    "--material-border": "#3A3F4B",
    "--fill-primary": "#E7E9EF",
    "--fill-secondary": "#9BA1AE",
    "--accent-color": "#7C93F5",
    "--zb-accent-hover": "#93A7F8",
    "--zb-accent-text": "#FFFFFF",
    "--zb-accent-soft": "rgba(124, 147, 245, 0.18)",
    "--zb-btn-bg": "#2C313B",
    "--zb-btn-hover": "#363C48",
    "--zb-input-bg": "#1F232B",
    "--zb-success": "#3FA37C",
    "--zb-selection": "#33405E"
  },
  mint: {
    label: "浅青绿",
    "--material-sidepane": "#F5F7F2",
    "--material-background": "#E9EEE5",
    "--material-border": "#CDD6C5",
    "--fill-primary": "#35402F",
    "--fill-secondary": "#74806C",
    "--accent-color": "#5B8C6E",
    "--zb-accent-hover": "#4A755C",
    "--zb-accent-text": "#FFFFFF",
    "--zb-accent-soft": "rgba(91, 140, 110, 0.15)",
    "--zb-btn-bg": "#FCFDFA",
    "--zb-btn-hover": "#E6EDE0",
    "--zb-input-bg": "#FCFDFA",
    "--zb-success": "#4F8A5F",
    "--zb-selection": "#D8E5D2"
  },
  lavender: {
    label: "浅雾紫",
    "--material-sidepane": "#F7F5FB",
    "--material-background": "#EEEAF5",
    "--material-border": "#D9D2E6",
    "--fill-primary": "#3D3852",
    "--fill-secondary": "#7E7896",
    "--accent-color": "#7E6BC4",
    "--zb-accent-hover": "#6A57B5",
    "--zb-accent-text": "#FFFFFF",
    "--zb-accent-soft": "rgba(126, 107, 196, 0.15)",
    "--zb-btn-bg": "#FDFCFE",
    "--zb-btn-hover": "#EBE5F6",
    "--zb-input-bg": "#FDFCFE",
    "--zb-success": "#5E9C7B",
    "--zb-selection": "#E2DAF4"
  },
  white: {
    "label": "白色",
    "--material-sidepane": "#FFFFFF",
    "--material-background": "#FFFFFF",
    "--material-border": "#D8DEE6",
    "--fill-primary": "#20252D",
    "--fill-secondary": "#637083",
    "--accent-color": "#455468",
    "--zb-accent-hover": "#344154",
    "--zb-accent-text": "#FFFFFF",
    "--zb-accent-soft": "#E7EDF4",
    "--zb-btn-bg": "#FFFFFF",
    "--zb-btn-hover": "#F2F5F8",
    "--zb-input-bg": "#FFFFFF",
    "--zb-success": "#257756",
    "--zb-selection": "#E7EDF4"
  },
  black: {
    "label": "黑色",
    "--material-sidepane": "#151515",
    "--material-background": "#090909",
    "--material-border": "#383838",
    "--fill-primary": "#F5F5F5",
    "--fill-secondary": "#B5B5B5",
    "--accent-color": "#909090",
    "--zb-accent-hover": "#A3A3A3",
    "--zb-accent-text": "#151515",
    "--zb-accent-soft": "#404040",
    "--zb-btn-bg": "#151515",
    "--zb-btn-hover": "#272727",
    "--zb-input-bg": "#151515",
    "--zb-success": "#57B98C",
    "--zb-selection": "#404040"
  },
  red: {
    "label": "朱红色",
    "--material-sidepane": "#B63229",
    "--material-background": "#96291F",
    "--material-border": "#D66B61",
    "--fill-primary": "#FFF5F2",
    "--fill-secondary": "#F5CDC7",
    "--accent-color": "#F8D2A8",
    "--zb-accent-hover": "#FFE0BF",
    "--zb-accent-text": "#67261C",
    "--zb-accent-soft": "#D9786D",
    "--zb-btn-bg": "#B63229",
    "--zb-btn-hover": "#C7473D",
    "--zb-input-bg": "#A82F25",
    "--zb-success": "#4F8A5F",
    "--zb-selection": "#D9786D"
  },
  blue: {
    "label": "天蓝色",
    "--material-sidepane": "#EDF6FF",
    "--material-background": "#DCECFB",
    "--material-border": "#B7D2EC",
    "--fill-primary": "#203B55",
    "--fill-secondary": "#52728E",
    "--accent-color": "#2475BC",
    "--zb-accent-hover": "#1A609D",
    "--zb-accent-text": "#FFFFFF",
    "--zb-accent-soft": "#BCD9F4",
    "--zb-btn-bg": "#EDF6FF",
    "--zb-btn-hover": "#D4E8FA",
    "--zb-input-bg": "#EDF6FF",
    "--zb-success": "#257756",
    "--zb-selection": "#BCD9F4"
  },
  orange: {
    "label": "暖橙色",
    "--material-sidepane": "#FFF4E8",
    "--material-background": "#FCE6CE",
    "--material-border": "#E6C49B",
    "--fill-primary": "#593B20",
    "--fill-secondary": "#8D6C49",
    "--accent-color": "#B96519",
    "--zb-accent-hover": "#9B5010",
    "--zb-accent-text": "#FFFFFF",
    "--zb-accent-soft": "#F4D0A3",
    "--zb-btn-bg": "#FFF4E8",
    "--zb-btn-hover": "#F9DEBE",
    "--zb-input-bg": "#FFF4E8",
    "--zb-success": "#257756",
    "--zb-selection": "#F4D0A3"
  }
};
var ZB_DEFAULT_THEME = "cream";

function zbGetThemeName() {
  try {
    if (typeof Zotero !== "undefined" && Zotero.Prefs) {
      let name = Zotero.Prefs.get("extensions.zotero-browser.theme", true);
      if (name && ZB_THEMES[name]) {
        return name;
      }
    }
  } catch (e) {}
  return ZB_DEFAULT_THEME;
}

function zbApplyThemeToElement(el, name) {
  let theme = ZB_THEMES[name] || ZB_THEMES[ZB_DEFAULT_THEME];
  try {
    for (let key of Object.keys(theme)) {
      if (key.startsWith("--")) {
        el.style.setProperty(key, theme[key]);
      }
    }
  } catch (e) {}
}


// ---- Main-window dock ---------------------------------------------------
// Zotero 10.0.3's main document (verified in app/omni.ja) has a stable
// `<hbox id="browser">` with `<vbox id="appcontent">` as its first child.
// The tab deck and the item pane live below appcontent.  The dock is mounted
// as a sibling of appcontent, so changing the selected tab/item never moves
// or reconstructs the browser elements.
const ZB_DOCK_WIDTH_PREF = "extensions.zotero-browser.dockWidth";
const ZB_DOCK_COLLAPSED_PREF = "extensions.zotero-browser.dockCollapsed";
const ZB_DOCK_DEFAULT_WIDTH = 430;
const ZB_DOCK_MIN_WIDTH = 280;
const ZB_DOCK_MAX_WIDTH = 920;
const ZB_DOCK_COLLAPSED_WIDTH = 0;

function zbDockClampWidth(value, win) {
  let n = Number(value);
  if (!Number.isFinite(n)) {
    n = ZB_DOCK_DEFAULT_WIDTH;
  }
  let max = ZB_DOCK_MAX_WIDTH;
  try {
    let viewport = win && win.document && win.document.getElementById("browser");
    let available = viewport && viewport.getBoundingClientRect ? viewport.getBoundingClientRect().width : 0;
    if (available > 0) {
      // Include the 7px divider, and permit a narrower dock in small windows.
      max = Math.min(max, Math.max(0, available - 260 - 7));
    }
  } catch (e) {}
  return Math.max(Math.min(ZB_DOCK_MIN_WIDTH, max), Math.min(max, Math.round(n)));
}

function zbDockLoadWidth(win) {
  try {
    let value = Zotero.Prefs.get(ZB_DOCK_WIDTH_PREF, true);
    return zbDockClampWidth(value, win);
  } catch (e) {
    return ZB_DOCK_DEFAULT_WIDTH;
  }
}

function zbDockSaveWidth(width) {
  try {
    Zotero.Prefs.set(ZB_DOCK_WIDTH_PREF, Math.round(width), true);
  } catch (e) {}
}

function zbDockLoadCollapsed() {
  try {
    let value = Zotero.Prefs.get(ZB_DOCK_COLLAPSED_PREF, true);
    return value === true || value === "true" || value === 1 || value === "1";
  } catch (e) {
    return false;
  }
}

function zbDockSaveCollapsed(collapsed) {
  try {
    Zotero.Prefs.set(ZB_DOCK_COLLAPSED_PREF, !!collapsed, true);
  } catch (e) {}
}

function zbDockCreateXULElement(doc, name) {
  try {
    if (doc && typeof doc.createXULElement === "function") {
      return doc.createXULElement(name);
    }
  } catch (e) {}
  try {
    return doc && doc.createElement(name);
  } catch (e) {
    return null;
  }
}

function zbNodeContains(parent, child) {
  try {
    return !!(parent && child && parent.contains(child));
  } catch (e) {}
  let cur = child;
  while (cur) {
    if (cur === parent) {
      return true;
    }
    cur = cur.parentNode;
  }
  return false;
}

/**
 * Locate only the container verified in Zotero's shipped zoteroPane.xhtml.
 * We deliberately do not guess at custom elements or move an existing
 * browser.  Returning null leaves the existing window layout untouched.
 */
function zbFindMainDockPlacement(win) {
  try {
    if (!win || win.closed || !win.document) {
      return null;
    }
    let doc = win.document;
    let browserRoot = doc.getElementById("browser");
    let appcontent = doc.getElementById("appcontent");
    let paneStack = doc.getElementById("zotero-pane-stack");
    let tabsDeck = doc.getElementById("tabs-deck");
    let pane = doc.getElementById("zotero-pane");
    if (!browserRoot || !appcontent || appcontent.parentNode !== browserRoot ||
        !paneStack || !tabsDeck || !pane ||
        !zbNodeContains(paneStack, tabsDeck) || !zbNodeContains(tabsDeck, pane)) {
      return null;
    }
    return { doc, container: browserRoot, appcontent, paneStack, tabsDeck, pane };
  } catch (e) {
    return null;
  }
}

function zbDockApplyContextTitle(state, title) {
  if (!state) {
    return;
  }
  let value = String(title || "").trim();
  if (!value) {
    value = "内置浏览器";
  }
  state.contextTitle = value;
  if (state.contextLabel) {
    state.contextLabel.textContent = value;
    state.contextLabel.title = value;
  }
}

// Selection/reader integration can call this when Zotero changes the active
// paper.  It only updates the dock chrome; it never navigates the browser.
function zbSetDockContextTitle(win, title) {
  let state = null;
  try {
    state = win && zbDockStates.get(win);
  } catch (e) {}
  if (!state) {
    try {
      if (win) {
        win.__zoteroBrowserDockContextTitle = String(title || "");
      }
    } catch (e) {}
    return false;
  }
  zbDockApplyContextTitle(state, title);
  return true;
}

function zbDockConfigureInstance(state, inst) {
  if (!state || !inst || !inst.wrapper) {
    return;
  }
  // The current sidebar script supports scope:'dock'.  Keep a small
  // compatibility shim for one already-loaded older script so a hot reload
  // cannot route the dock as a selected-item sidebar instance.
  if (inst.scope !== "dock") {
    BrowserHub.browsers = BrowserHub.browsers.filter(item => item !== inst);
    try {
      inst.scope = "dock";
    } catch (e) {}
  }
  if (!BrowserHub.browsers.includes(inst)) {
    BrowserHub.register(inst);
  }
  let wrapper = inst.wrapper;
  wrapper.setAttribute("data-zotero-browser-scope", "dock");
  wrapper.style.flex = "1 1 auto";
  wrapper.style.width = "100%";
  wrapper.style.height = "100%";
  wrapper.style.minHeight = "0";
  wrapper.style.overflow = "hidden";
  let resize = wrapper.querySelector && wrapper.querySelector(".zb-resize-handle");
  if (resize) {
    resize.style.display = "none";
  }
  let viewport = wrapper.querySelector && wrapper.querySelector(".zb-browser-viewport");
  if (!viewport) {
    // The browser viewport currently has no class in older plugin builds.
    // It is still safe to identify it by the embedded browser element's
    // closest div, without touching the browser/docshell itself.
    try {
      let embedded = wrapper.querySelector("browser");
      viewport = embedded && embedded.parentNode;
    } catch (e) {}
  }
  if (viewport && viewport.style) {
    viewport.style.minHeight = "0";
    viewport.style.overflow = "hidden";
    viewport.style.flex = "1 1 auto";
  }

}

function zbDockSetCollapsed(state, collapsed, persist) {
  if (!state || !state.root) {
    return;
  }
  state.collapsed = !!collapsed;
  if (!state.collapsed) {
    state.width = zbDockClampWidth(state.width, state.window);
  }
  let width = state.collapsed ? ZB_DOCK_COLLAPSED_WIDTH : state.width;
  state.root.style.width = width + "px";
  state.root.style.minWidth = width + "px";
  state.root.style.maxWidth = width + "px";
  state.root.style.flexBasis = width + "px";
  state.root.style.display = state.collapsed ? "none" : "flex";
  if (state.splitter) {
    state.splitter.style.display = state.collapsed ? "none" : "block";
  }
  state.root.setAttribute("aria-expanded", state.collapsed ? "false" : "true");
  state.root.setAttribute("data-collapsed", state.collapsed ? "true" : "false");
  if (state.host) {
    state.host.style.display = state.collapsed ? "none" : "flex";
  }
  if (state.collapseButton) {
    state.collapseButton.textContent = state.collapsed ? "‹" : "›";
    state.collapseButton.title = state.collapsed ? "展开右侧浏览器" : "折叠右侧浏览器";
    state.collapseButton.setAttribute("aria-label", state.collapseButton.title);
  }
  if (state.contextLabel) {
    state.contextLabel.style.display = state.collapsed ? "none" : "block";
  }
  if (persist) {
    zbDockSaveCollapsed(state.collapsed);
  }
}

function zbDockApplyWidth(state, width, persist) {
  if (!state) {
    return;
  }
  state.width = zbDockClampWidth(width, state.window);
  if (!state.collapsed) {
    zbDockSetCollapsed(state, false, false);
  }
  if (persist) {
    zbDockSaveWidth(state.width);
  }
}

function zbDockInstallResize(state) {
  if (!state || !state.splitter || state.resizeInstalled) {
    return;
  }
  let doc = state.doc;
  let win = state.window;
  let onMouseDown = (event) => {
    if (state.collapsed || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    state.resizing = true;
    state.resizeRestore = {
      cursor: doc.documentElement && doc.documentElement.style.cursor,
      userSelect: doc.documentElement && doc.documentElement.style.userSelect
    };
    state.resizeStartX = event.screenX || event.clientX;
    state.resizeStartWidth = state.width;
    state.splitter.style.background = "var(--accent-color, #2563eb)";
    try {
      doc.documentElement.style.cursor = "col-resize";
      doc.documentElement.style.userSelect = "none";
    } catch (e) {}
  };
  let onMouseMove = (event) => {
    if (!state.resizing) {
      return;
    }
    event.preventDefault();
    let x = event.screenX || event.clientX;
    // The dock is on the right, so dragging left grows it.
    zbDockApplyWidth(state, state.resizeStartWidth - (x - state.resizeStartX), false);
  };
  let onMouseUp = (event) => {
    if (!state.resizing) {
      return;
    }
    state.resizing = false;
    let x = event.screenX || event.clientX;
    zbDockApplyWidth(state, state.resizeStartWidth - (x - state.resizeStartX), true);
    state.splitter.style.background = "var(--material-background, #e5e7eb)";
    try {
      doc.documentElement.style.cursor = state.resizeRestore ? state.resizeRestore.cursor : "";
      doc.documentElement.style.userSelect = state.resizeRestore ? state.resizeRestore.userSelect : "";
      state.resizeRestore = null;
    } catch (e) {}
  };
  state.resizeHandlers = { onMouseDown, onMouseMove, onMouseUp };
  state.splitter.addEventListener("mousedown", onMouseDown, true);
  win.addEventListener("mousemove", onMouseMove, true);
  win.addEventListener("mouseup", onMouseUp, true);
  state.resizeWindowHandler = () => {
    if (!state.collapsed) {
      let next = zbDockClampWidth(state.width, win);
      if (next !== state.width) {
        zbDockApplyWidth(state, next, true);
      }
    }
  };
  win.addEventListener("resize", state.resizeWindowHandler, true);
  state.resizeInstalled = true;
}

function zbDockFocus(state) {
  try {
    if (state && state.instance && state.instance.wrapper) {
      state.instance.wrapper.focus();
    }
  } catch (e) {}
}

function zbDockCreateState(win, placement) {
  let doc = placement.doc;
  let state = {
    window: win,
    doc,
    container: placement.container,
    appcontent: placement.appcontent,
    root: null,
    splitter: null,
    header: null,
    contextLabel: null,
    collapseButton: null,
    host: null,
    instance: null,
    width: zbDockLoadWidth(win),
    collapsed: zbDockLoadCollapsed(),
    contextTitle: "内置浏览器",
    resizeInstalled: false,
    resizing: false,
    resizeRestore: null,
    resizeWindowHandler: null,
    retryTimer: null,
    unloadHandler: null
  };

  let root = doc.getElementById("zotero-browser-dock");
  let splitter = doc.getElementById("zotero-browser-dock-splitter");
  if (!root || root.parentNode !== placement.container) {
    root = zbDockCreateXULElement(doc, "vbox");
    splitter = zbDockCreateXULElement(doc, "splitter");
    if (!root || !splitter) {
      return null;
    }
    root.id = "zotero-browser-dock";
    root.setAttribute("data-zotero-browser-dock", "true");
    root.setAttribute("flex", "0");
    splitter.id = "zotero-browser-dock-splitter";
    splitter.setAttribute("orient", "vertical");
    splitter.setAttribute("collapse", "after");
    splitter.setAttribute("resizebefore", "closest");
    splitter.setAttribute("resizeafter", "closest");
    placement.container.appendChild(splitter);
    placement.container.appendChild(root);
  }
  state.root = root;
  state.splitter = splitter;
  root.style.cssText =
    "display:flex;flex-direction:column;flex:0 0 auto;min-height:0;box-sizing:border-box;" +
    "overflow:hidden;background:var(--material-sidepane,#fff);" +
    "color:var(--fill-primary,#212529);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;" +
    "border-left:1px solid var(--material-border,#d1d5db);";
  splitter.style.cssText =
    "display:block;flex:0 0 7px;width:7px;min-width:7px;min-height:0;box-sizing:border-box;" +
    "cursor:col-resize;background:var(--material-background,#e5e7eb);" +
    "border-left:1px solid var(--material-border,#d1d5db);border-right:1px solid var(--material-border,#d1d5db);";

  let header = zbDockCreateXULElement(doc, "hbox");
  header.style.cssText =
    "display:flex;align-items:center;gap:4px;min-height:30px;padding:2px 4px;" +
    "flex:0 0 auto;background:var(--material-background,#f3f4f6);" +
    "border-bottom:1px solid var(--material-border,#d1d5db);overflow:hidden;";
  let contextLabel = doc.createElement("div");
  contextLabel.style.cssText = "display:block;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600;";
  let collapseButton = doc.createElement("button");
  collapseButton.type = "button";
  collapseButton.textContent = "›";
  collapseButton.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:23px;height:24px;padding:0;border:1px solid var(--material-border,#d1d5db);border-radius:4px;background:var(--zb-btn-bg,#fff);color:inherit;cursor:pointer;font-size:18px;line-height:1;flex:0 0 auto;";
  collapseButton.addEventListener("click", (event) => {
    event.preventDefault();
    zbDockSetCollapsed(state, !state.collapsed, true);
  });
  header.appendChild(contextLabel);
  header.appendChild(collapseButton);
  root.appendChild(header);

  let host = doc.createElement("div");
  host.id = "zotero-browser-dock-host";
  host.style.cssText = "display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0;overflow:hidden;padding:0;margin:0;";
  root.appendChild(host);
  state.header = header;
  state.contextLabel = contextLabel;
  state.collapseButton = collapseButton;
  state.host = host;
  zbDockApplyContextTitle(state, win.__zoteroBrowserDockContextTitle || "内置浏览器");
  zbDockInstallResize(state);
  zbDockSetCollapsed(state, state.collapsed, false);
  state.unloadHandler = () => zbDockRemoveForWindow(win);
  win.addEventListener("unload", state.unloadHandler, { once: true });
  return state;
}

function zbDockInstantiate(state) {
  if (!state || state.instance || !state.host) {
    return state && state.instance;
  }
  try {
    loadSidebarScript();
    let existingWrapper = state.host.querySelector(".zotero-browser-sidebar-wrapper");
    if (existingWrapper && existingWrapper._zbInstance) {
      state.instance = existingWrapper._zbInstance;
      zbDockConfigureInstance(state, state.instance);
      return state.instance;
    }
    let inst = initSidebarBrowser(state.doc, state.host, { scope: "dock" });
    if (inst) {
      state.instance = inst;
      zbDockConfigureInstance(state, inst);
    }
    return inst;
  } catch (e) {
    dump("[Zotero Browser] dock init error: " + e + "\n");
    return null;
  }
}

function zbScheduleDockRetry(win) {
  if (!win || win._zoteroBrowserDockRetryTimer) {
    return;
  }
  let attempts = 0;
  let retry = () => {
    try {
      delete win._zoteroBrowserDockRetryTimer;
      if (win.closed) {
        return;
      }
      if (zbEnsureDockForWindow(win, false)) {
        return;
      }
      attempts++;
      if (attempts < 12) {
        win._zoteroBrowserDockRetryTimer = win.setTimeout(retry, 250);
      }
    } catch (e) {}
  };
  try {
    win._zoteroBrowserDockRetryTimer = win.setTimeout(retry, 0);
  } catch (e) {}
}

function zbEnsureDockForWindow(win, retryMissing = true) {
  let placement = zbFindMainDockPlacement(win);
  if (!placement) {
    // An independent Reader window has no main-pane IDs and should go
    // to the main-window dock. Retry only while the verified main
    // document is still being assembled.
    let doc = null;
    try { doc = win && win.document; } catch (e) {}
    let looksLikeMain = !!(doc && (doc.getElementById("zotero-pane-stack") ||
      /zoteroPane\.xhtml(?:$|[#?])/.test(String(doc.documentURI || ""))));
    if (looksLikeMain && retryMissing) {
      zbScheduleDockRetry(win);
    }
    return null;
  }
  let state = null;
  try {
    state = zbDockStates.get(win) || win.__zoteroBrowserDockState || null;
  } catch (e) {}
  if (!state || !state.root || state.root.parentNode !== placement.container) {
    if (state) {
      zbDockRemoveForWindow(win);
    }
    state = zbDockCreateState(win, placement);
    if (!state) {
      return null;
    }
    zbDockStates.set(win, state);
    try {
      win.__zoteroBrowserDockState = state;
    } catch (e) {}
  }
  if (!state.instance) {
    zbDockInstantiate(state);
  } else {
    zbDockConfigureInstance(state, state.instance);
  }
  return state;
}

function zbOpenDockForWindow(win) {
  let state = zbEnsureDockForWindow(win);
  if (!state) {
    return false;
  }
  zbDockSetCollapsed(state, false, true);
  zbDockFocus(state);
  return !!state.instance;
}

function zbToggleDock(win) {
  let state = zbEnsureDockForWindow(win);
  if (!state) {
    return false;
  }
  zbDockSetCollapsed(state, !state.collapsed, true);
  if (!state.collapsed) {
    zbDockFocus(state);
  }
  return !!state.instance;
}

function zbResolveDockWindow(win) {
  if (zbFindMainDockPlacement(win)) return win;
  return getZoteroWindows().find(candidate => zbFindMainDockPlacement(candidate)) || null;
}

function toggleRightBrowser(win) {
  let target = zbResolveDockWindow(win);
  if (target && zbToggleDock(target)) {
    if (target !== win) target.focus();
    return;
  }
  Services.prompt.alert(win || null, "Zotero Browser", "右侧浏览器尚未就绪，请先打开 Zotero 主窗口后重试。");
}

function renderSidebarDockLauncher(doc, body) {
  if (!doc || !body) {
    return;
  }
  try {
    body.textContent = "";
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.alignItems = "stretch";
    body.style.padding = "8px";
    body.style.margin = "0";
    let wrap = doc.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--material-border,#d1d5db);border-radius:6px;background:var(--material-background,#f8fafc);font-size:11px;";
    let label = doc.createElement("div");
    label.textContent = "浏览器已固定在 Zotero 主窗口右侧";
    label.style.cssText = "color:var(--fill-secondary,#6b7280);line-height:1.4;";
    let button = doc.createElement("button");
    button.type = "button";
    button.textContent = "打开右侧浏览器";
    button.title = "显示右侧内置浏览器（标签页与网页保持不变）";
    button.style.cssText = "height:28px;border:1px solid var(--material-border,#d1d5db);border-radius:5px;background:var(--zb-btn-bg,#fff);color:inherit;cursor:pointer;font-size:12px;";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      let target = zbResolveDockWindow(doc.defaultView);
      if (target) { zbOpenDockForWindow(target); target.focus(); }
    });
    wrap.appendChild(label);
    wrap.appendChild(button);
    body.appendChild(wrap);
  } catch (e) {
    dump("[Zotero Browser] dock launcher error: " + e + "\n");
  }
}

function zbDockRemoveForWindow(win) {
  let state = null;
  try {
    if (win && win._zoteroBrowserDockRetryTimer) {
      win.clearTimeout(win._zoteroBrowserDockRetryTimer);
      delete win._zoteroBrowserDockRetryTimer;
    }
  } catch (e) {}
  try {
    state = zbDockStates.get(win) || win.__zoteroBrowserDockState || null;
  } catch (e) {}
  if (!state) {
    return;
  }
  try {
    if (state.retryTimer && win && win.clearTimeout) {
      win.clearTimeout(state.retryTimer);
    }
  } catch (e) {}
  try {
    if (state.unloadHandler) {
      win.removeEventListener("unload", state.unloadHandler, true);
      win.removeEventListener("unload", state.unloadHandler);
    }
  } catch (e) {}
  if (state.resizeHandlers) {
    try { state.splitter.removeEventListener("mousedown", state.resizeHandlers.onMouseDown, true); } catch (e) {}
    try { win.removeEventListener("mousemove", state.resizeHandlers.onMouseMove, true); } catch (e) {}
    try { win.removeEventListener("mouseup", state.resizeHandlers.onMouseUp, true); } catch (e) {}
  }
  if (state.resizeWindowHandler) {
    try { win.removeEventListener("resize", state.resizeWindowHandler, true); } catch (e) {}
  }
  if (state.resizing) {
    try {
      win.document.documentElement.style.cursor = state.resizeRestore ? state.resizeRestore.cursor : "";
      win.document.documentElement.style.userSelect = state.resizeRestore ? state.resizeRestore.userSelect : "";
    } catch (e) {}
    state.resizing = false;
    state.resizeRestore = null;
  }
  try {
    if (state.instance && typeof state.instance.dispose === "function") {
      state.instance.dispose();
    } else if (state.instance && typeof state.instance.destroy === "function") {
      state.instance.destroy();
    }
  } catch (e) {
    dump("[Zotero Browser] dock dispose error: " + e + "\n");
  }
  if (state.instance) {
    BrowserHub.browsers = BrowserHub.browsers.filter(inst => inst !== state.instance);
  }
  try {
    if (state.root && state.root.parentNode) {
      state.root.parentNode.removeChild(state.root);
    }
  } catch (e) {}
  try {
    if (state.splitter && state.splitter.parentNode) {
      state.splitter.parentNode.removeChild(state.splitter);
    }
  } catch (e) {}
  try {
    zbDockStates.delete(win);
    delete win.__zoteroBrowserDockState;
  } catch (e) {}
}

const ZB_SHORTCUTS_PREF = "extensions.zotero-browser.shortcuts";
const ZB_TOGGLE_SHORTCUT_DEFAULT = "Mod+Shift+B";

function zbGetToggleShortcutCombo() {
  try {
    let raw = Zotero.Prefs.get(ZB_SHORTCUTS_PREF, true);
    if (raw) {
      let map = JSON.parse(raw);
      let combo = map.toggleBrowserPanel ?? map.toggleGlobalWindow;
      if (typeof combo === "string") return combo;
    }
  } catch (e) {}
  return ZB_TOGGLE_SHORTCUT_DEFAULT;
}

function zbComboLabel(combo) {
  if (!combo) {
    return "未设置";
  }
  return String(combo).replace(/^Mod/, "⌘/Ctrl");
}

// 与 sidebar-browser.js 的 comboFromEvent 输出格式保持一致：
// "Mod+Alt+Shift+KEY"，Mod 代表 Ctrl 或 Cmd。
function zbEventMatchesCombo(e, combo) {
  if (!e || !combo || typeof combo !== "string") {
    return false;
  }
  let parts = combo.split("+");
  let key = parts.pop();
  let needMod = parts.includes("Mod");
  let needAlt = parts.includes("Alt");
  let needShift = parts.includes("Shift");
  if (needMod !== !!(e.ctrlKey || e.metaKey)) {
    return false;
  }
  if (needAlt !== !!e.altKey) {
    return false;
  }
  if (needShift !== !!e.shiftKey) {
    return false;
  }
  let ek = e.key;
  if (!ek || ek === "Control" || ek === "Meta" || ek === "Alt" || ek === "Shift") {
    return false;
  }
  if (ek === " ") {
    ek = "Space";
  }
  if (ek.length === 1) {
    ek = ek.toUpperCase();
  }
  return ek === key;
}

function addToWindow(win) {
  let doc = win.document;
  if (!doc) return;

  installPopupRouter(win);

  if (!doc.querySelector('link[href="zotero-browser.ftl"]')) {
    try {
      let link = doc.createElement("link");
      link.rel = "localization";
      link.href = "zotero-browser.ftl";
      if (doc.head) {
        doc.head.appendChild(link);
      } else {
        doc.documentElement.appendChild(link);
      }
    } catch (e) {}
  }

  let toolsPopup = doc.getElementById("menu_ToolsPopup") || doc.querySelector("#menu_Tools > menupopup");
  if (toolsPopup && !doc.getElementById("zotero-browser-menu-item")) {
    let menuitem = doc.createXULElement ? doc.createXULElement("menuitem") : doc.createElement("menuitem");
    menuitem.id = "zotero-browser-menu-item";
    menuitem.setAttribute("label", "打开/收回右侧内置浏览器 (Zotero Browser)");
    menuitem.setAttribute("accesskey", "B");
    menuitem.setAttribute("acceltext", zbComboLabel(zbGetToggleShortcutCombo()));
    menuitem.addEventListener("command", function () {
      toggleRightBrowser(win);
    });
    toolsPopup.appendChild(menuitem);
  }

  let toolbar = doc.getElementById("zotero-toolbar") || doc.getElementById("main-toolbar") || doc.querySelector("toolbar");
  // Remove the old global copy entry when updating from 1.7.2.
  doc.getElementById("zotero-browser-copy-pdf-toolbar-btn")?.remove();
  if (!doc.getElementById("zotero-browser-toolbar-style")) {
    const style = doc.createElement("style");
    style.id = "zotero-browser-toolbar-style";
    style.textContent = `
      #zotero-browser-toolbar-btn, #zotero-browser-cite-toolbar-btn {
        width:28px; min-width:28px; height:28px; padding:4px;
        margin:0 2px; border-radius:5px;
      }
      #zotero-browser-toolbar-btn .toolbarbutton-icon,
      #zotero-browser-cite-toolbar-btn .toolbarbutton-icon {
        width:18px; height:18px; margin:0;
        -moz-context-properties:fill; fill:currentColor;
      }
      #zotero-browser-toolbar-btn .toolbarbutton-text,
      #zotero-browser-cite-toolbar-btn .toolbarbutton-text { display:none; }
    `;
    doc.documentElement.appendChild(style);
  }
  if (toolbar && !doc.getElementById("zotero-browser-toolbar-btn")) {
    let btn = doc.createXULElement ? doc.createXULElement("toolbarbutton") : doc.createElement("toolbarbutton");
    btn.id = "zotero-browser-toolbar-btn";
    btn.setAttribute("aria-label", "浏览器");
    btn.setAttribute("tooltiptext", "打开/收回右侧内置浏览器（" + zbComboLabel(zbGetToggleShortcutCombo()) + "）");
    btn.setAttribute("class", "zotero-tb-button");
    btn.style.listStyleImage = `url("chrome://zotero-browser/content/icons/icon.svg")`;
    btn.style.cursor = "pointer";
    btn.addEventListener("command", function () {
      toggleRightBrowser(win);
    });
    toolbar.appendChild(btn);
  }
  if (toolbar && !doc.getElementById("zotero-browser-cite-toolbar-btn")) {
    const button = doc.createXULElement ? doc.createXULElement("toolbarbutton") : doc.createElement("toolbarbutton");
    button.id = "zotero-browser-cite-toolbar-btn";
    button.setAttribute("aria-label", "Cite · ADS BibTeX");
    button.setAttribute("tooltiptext", "Cite：获取当前 Zotero 论文的 NASA ADS BibTeX");
    button.setAttribute("class", "zotero-tb-button");
    button.style.listStyleImage = 'url("chrome://zotero-browser/content/icons/cite.svg")';
    button.addEventListener("command", () => zbOpenCite(win));
    const globe = doc.getElementById("zotero-browser-toolbar-btn");
    toolbar.insertBefore(button, globe ? globe.nextSibling : null);
  }

  if (!win._zoteroBrowserKeyHandler) {
    win._zoteroBrowserKeyHandler = function (e) {
      try {
        if (win.__zbRecordingShortcut) {
          return; // 设置面板正在录制快捷键，不触发切换
        }
      } catch (err) {}
      if (zbEventMatchesCombo(e, zbGetToggleShortcutCombo())) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) toggleRightBrowser(win);
      }
    };
    win.addEventListener("keydown", win._zoteroBrowserKeyHandler, true);
  }

  // Mount once per main-window document.  If startup ran before Zotero's
  // xhtml finished loading, zbEnsureDockForWindow schedules a bounded retry.
  zbEnsureDockForWindow(win);
}

function removeFromWindow(win) {
  let doc = win.document;
  if (!doc) return;

  uninstallPopupRouter(win);

  let menuitem = doc.getElementById("zotero-browser-menu-item");
  if (menuitem) menuitem.remove();


  let btn = doc.getElementById("zotero-browser-toolbar-btn");
  if (btn) btn.remove();
  doc.getElementById("zotero-browser-cite-toolbar-btn")?.remove();
  doc.getElementById("zotero-browser-copy-pdf-toolbar-btn")?.remove();
  doc.getElementById("zotero-browser-toolbar-style")?.remove();
  doc.getElementById("zb-home-styles")?.remove();
  zbDisposeCitePopup(win);

  zbDockRemoveForWindow(win);
  BrowserHub.forgetDocument(doc);

  let l10nLink = doc.querySelector('link[href="zotero-browser.ftl"]');
  if (l10nLink) l10nLink.remove();

  if (win._zoteroBrowserKeyHandler) {
    win.removeEventListener("keydown", win._zoteroBrowserKeyHandler, true);
    delete win._zoteroBrowserKeyHandler;
  }

}
