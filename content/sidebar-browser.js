/**
 * Sidebar native Gecko browser UI.
 * Loaded into bootstrap.js scope via loadSubScript.
 */
/* global Zotero, Services, Ci, Cc, ChromeUtils, Components, BrowserHub, zbIsPdfUrl, zbFetchPdfBuffer, zbCopyToLocalBuffer, pluginRootURI, zbParseSafariBinaryCookies */

function zbCreateHomeSearch(doc, options) {
  const form = doc.createElement("form");
  form.className = "zb-home-search";
  form.setAttribute("role", "search");
  form.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 10px;margin:0 0 24px;border:1px solid var(--material-border,#d1d5db);border-radius:28px;background:#f8fafc;color:#253044;box-shadow:0 2px 10px rgba(0,0,0,.08);";
  const engine = doc.createElement("select");
  engine.className = "zb-home-engine";
  engine.setAttribute("aria-label", "主页搜索引擎");
  engine.style.cssText = "flex:0 0 104px;width:104px;min-width:104px;max-width:none;box-sizing:border-box;height:40px;padding:0 12px;border:0;background:transparent;color:inherit;font:13px/normal -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer;";
  for (const item of options.engines) {
    const option = doc.createElement("option"); option.value = item.id; option.textContent = item.name; engine.appendChild(option);
  }
  engine.value = options.getEngine();
  engine.addEventListener("change", () => options.setEngine(engine.value));
  const input = doc.createElement("input");
  input.className = "zb-home-query";
  input.type = "text"; input.placeholder = "搜索关键词或输入网址";
  input.setAttribute("aria-label", "主页搜索关键词或网址");
  input.style.cssText = "flex:1;min-width:0;width:100%;box-sizing:border-box;height:40px;padding:0 8px;border:0;outline:none;background:transparent;color:inherit;font:14px/normal -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;";
  const button = doc.createElement("button");
  button.type = "button"; button.title = "搜索"; button.setAttribute("aria-label", "搜索");
  button.style.cssText = "display:flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;padding:6px;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;";
  button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg>';
  function submit() { if (input.value.trim()) options.submit(input.value); }
  button.addEventListener("click", submit);
  form.addEventListener("submit", event => { event.preventDefault(); submit(); });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(); }
  });
  form.appendChild(engine); form.appendChild(input); form.appendChild(button);
  return { root: form, input, engine };
}

function zbCreateThemeChoices(doc, themes, onSelect) {
  const rows = [];
  const colorGrid = doc.createElement("div");
  colorGrid.style.cssText = "display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-bottom:14px;";

  for (let id of Object.keys(themes)) {
    let theme = themes[id];
    let row = doc.createElement("button");
    row._zbThemeId = id;
    row.type = "button"; row.className = "zb-theme-choice";
    row.setAttribute("aria-label", theme.label || id);
    row.title = (theme.label || id) + "：预览底色、文字和强调色";
    row.style.cssText = "display:flex;flex-direction:column;gap:5px;height:auto;min-height:60px;padding:5px 2px;font-size:10px;cursor:pointer;";
    const swatch = doc.createElement("span");
    swatch.style.cssText = "display:flex;align-items:center;justify-content:center;gap:4px;width:34px;height:27px;flex:none;border-radius:5px;border:1px solid " + theme["--material-border"] + ";background:" + theme["--material-sidepane"] + ";color:" + theme["--fill-primary"] + ";";
    const sample = doc.createElement("span"); sample.textContent = "Aa"; sample.style.fontSize = "11px";
    const accent = doc.createElement("span"); accent.style.cssText = "width:5px;height:14px;border-radius:3px;background:" + theme["--accent-color"] + ";";
    swatch.appendChild(sample); swatch.appendChild(accent);
    const label = doc.createElement("span"); label.textContent = theme.label || id;
    row.appendChild(swatch); row.appendChild(label);
    row.addEventListener("click", () => onSelect(id));
    colorGrid.appendChild(row);
    rows.push(row);
  }
  return { root: colorGrid, rows };
}

function zbInitSidebarBrowser(doc, body, options = {}) {
  if (!doc || !body) {
    return null;
  }
  let scope = options.scope === "dock" ? "dock" : "sidebar";
  let localWrapper = body.querySelector(".zotero-browser-sidebar-wrapper");
  if (localWrapper && localWrapper._zbInstance) {
    return localWrapper._zbInstance;
  }

  try {
    return zbBuildSidebarBrowser(doc, body, { scope });
  } catch (err) {
    dump("[Zotero Browser] zbBuildSidebarBrowser error: " + err + "\n" + (err && err.stack ? err.stack : "") + "\n");
    try {
      body.textContent = "";
      let box = doc.createElement("div");
      box.style.cssText = "padding:14px;color:#b91c1c;font-size:12px;line-height:1.5;white-space:pre-wrap;";
      box.textContent = "内置浏览器初始化失败:\n" + err;
      body.appendChild(box);
    } catch (e2) {}
  }
}

function zbBuildSidebarBrowser(doc, body, options = {}) {
  if (!doc || !body) {
    return null;
  }
  let scope = options.scope === "dock" ? "dock" : "sidebar";

  const Cr = Components.results;
  const SYSTEM_PRINCIPAL = Services.scriptSecurityManager.getSystemPrincipal();

  const PREF_SIDEBAR_HEIGHT = "extensions.zotero-browser.sidebarHeight";
  const DEFAULT_SIDEBAR_HEIGHT = 1025;
  const MIN_SIDEBAR_HEIGHT = 350;
  const MAX_SIDEBAR_HEIGHT = 2800;

  function loadSidebarHeight() {
    try {
      if (Zotero.Prefs.prefHasUserValue(PREF_SIDEBAR_HEIGHT)) {
        let val = parseInt(Zotero.Prefs.get(PREF_SIDEBAR_HEIGHT, true), 10);
        if (Number.isFinite(val) && val >= MIN_SIDEBAR_HEIGHT && val <= MAX_SIDEBAR_HEIGHT) {
          return val;
        }
      }
    } catch (e) {}
    return DEFAULT_SIDEBAR_HEIGHT;
  }

  function saveSidebarHeight(h) {
    try {
      Zotero.Prefs.set(PREF_SIDEBAR_HEIGHT, Math.round(h), true);
    } catch (e) {}
  }

  let currentSidebarHeight = loadSidebarHeight();

  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.flex = "1";
  body.style.minHeight = "0";
  body.style.overflow = "hidden";
  body.style.padding = "0";
  body.style.margin = "0";

  let section = body.closest("collapsible-section");
  if (section) {
    section.style.display = "flex";
    section.style.flexDirection = "column";
    section.style.flex = "1";
    let sectionsParent = section.closest("collapsible-sections") || section.parentElement;
    if (sectionsParent) {
      sectionsParent.style.display = "flex";
      sectionsParent.style.flexDirection = "column";
      sectionsParent.style.flex = "1";
      sectionsParent.style.minHeight = "0";
      sectionsParent.style.overflow = "hidden";
    }
    section.style.minHeight = "0";
    section.style.overflow = "hidden";
  }

  let wrapper = doc.createElement("div");
  wrapper.className = "zotero-browser-sidebar-wrapper";
  wrapper.style.cssText = `
    display: flex;
    flex-direction: column;
    width: 100%;
    flex: 1;
    background: var(--material-sidepane, #ffffff);
    color: var(--fill-primary, #212529);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    box-sizing: border-box;
    padding: 0;
    margin: 0;
    min-height: 0;
    position: relative;
    overflow: hidden;
  `;
  wrapper.tabIndex = 0;
  let disposeCallbacks = [];
  function registerDispose(callback) {
    if (typeof callback === "function") {
      disposeCallbacks.push(callback);
    }
  }

  function applyHeight(h) {
    if (scope === "dock") {
      // The dock owns the available height.  Do not impose the sidebar's
      // persisted pixel height or expose its resize handle in this scope.
      body.style.minHeight = "0";
      body.style.height = "auto";
      if (section) {
        section.style.minHeight = "0";
        section.style.height = "auto";
      }
      let dockSectionsParent = (section && section.closest("collapsible-sections")) ||
        (section && section.parentElement);
      if (dockSectionsParent) {
        dockSectionsParent.style.minHeight = "0";
        dockSectionsParent.style.height = "auto";
      }
      wrapper.style.minHeight = "0";
      wrapper.style.height = "auto";
      if (typeof viewport !== "undefined" && viewport) {
        viewport.style.minHeight = "0";
      }
      return;
    }
    if (scope !== "sidebar") {
      return;
    }
    let clamped = Math.max(MIN_SIDEBAR_HEIGHT, Math.min(MAX_SIDEBAR_HEIGHT, Math.round(h)));
    currentSidebarHeight = clamped;
    let px = clamped + "px";
    body.style.minHeight = px;
    body.style.height = px;
    if (section) {
      section.style.minHeight = px;
      section.style.height = px;
    }
    let sectionsParent = (section && section.closest("collapsible-sections")) || (section && section.parentElement);
    if (sectionsParent) {
      sectionsParent.style.minHeight = px;
      sectionsParent.style.height = px;
    }
    wrapper.style.minHeight = px;
    wrapper.style.height = px;
    // Fixed chrome (tab bar, toolbars, resize handle) totals ~151px; keep the
    // viewport minimum below that so flex layout never clips the resize bar.
    let vpMin = Math.max(200, clamped - 160);
    viewport.style.minHeight = vpMin + "px";
  }

  function attachTo(host) {
    if (!host || wrapper.parentNode === host) {
      return;
    }
    while (host.firstChild) {
      host.removeChild(host.firstChild);
    }
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.flex = "1";
    host.style.minHeight = "0";
    host.style.height = scope === "dock" ? "auto" : host.style.height;
    host.style.overflow = "hidden";
    applyHeight(currentSidebarHeight);
    wrapper.style.flex = "1";
    host.appendChild(wrapper);
  }

  function createBtn(text, title, onClick) {
    let btn = doc.createElement("button");
    btn.innerHTML = text;
    btn.title = title;
    btn.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 26px;
      padding: 0 6px;
      border: 1px solid var(--material-border, #d1d5db);
      border-radius: 6px;
      background: var(--zb-btn-bg, var(--material-sidepane, #ffffff));
      color: inherit;
      cursor: pointer;
      font-size: 12px;
      user-select: none;
      white-space: nowrap;
    `;
    btn.addEventListener("click", onClick);
    return btn;
  }

  /* ---------- 主题皮肤系统 ---------- */
  const PREF_THEME = "extensions.zotero-browser.theme";

  function svgIcon(paths, size) {
    let s = size || 14;
    // xmlns is mandatory: the Zotero main document is XUL/XML, so innerHTML
    // fragments are parsed as XML and <svg> only renders in the SVG namespace.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0;">${paths}</svg>`;
  }
  const ICONS = {
    back: '<polyline points="15 18 9 12 15 6"></polyline>',
    forward: '<polyline points="9 18 15 12 9 6"></polyline>',
    reload: '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
    stop: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline>',
    go: '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>',
    chevronUp: '<polyline points="18 15 12 9 6 15"></polyline>',
    chevronDown: '<polyline points="6 9 12 15 18 9"></polyline>',
    palette: '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.26-.29-.43-.69-.43-1.12 0-.93.75-1.68 1.68-1.68h1.99C19.85 16.38 22 14.23 22 10.85 21.95 5.9 17.5 2 12 2z"></path><circle cx="13.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"></circle><circle cx="17.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"></circle><circle cx="8.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"></circle><circle cx="6.5" cy="12.5" r="1.1" fill="currentColor" stroke="none"></circle>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>',
    cookie: '<circle cx="12" cy="12" r="9"></circle><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"></circle><circle cx="14" cy="9" r="1" fill="currentColor" stroke="none"></circle><circle cx="10" cy="14.5" r="1" fill="currentColor" stroke="none"></circle><circle cx="14.5" cy="13.5" r="1" fill="currentColor" stroke="none"></circle>',
    gear: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>',
    retract: '<polyline points="7 13 12 18 17 13"></polyline><polyline points="7 6 12 11 17 6"></polyline>'
  };

  function themeStylesheet() {
    return `
.zotero-browser-sidebar-wrapper button {
  border-radius: 6px !important;
  border: 1px solid var(--material-border, #d1d5db) !important;
  background: var(--zb-btn-bg, var(--material-sidepane, #ffffff)) !important;
  color: var(--fill-primary, #212529) !important;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.06s ease !important;
}
.zotero-browser-sidebar-wrapper button:hover:not(:disabled) {
  background: var(--zb-btn-hover, var(--material-background, #f3f4f6)) !important;
  border-color: var(--accent-color, #d1d5db) !important;
}
.zotero-browser-sidebar-wrapper button:active:not(:disabled) {
  transform: translateY(0.5px);
}
.zotero-browser-sidebar-wrapper button:disabled { opacity: 0.45; }
.zotero-browser-sidebar-wrapper button.zb-btn-primary {
  background: var(--accent-color) !important;
  border-color: var(--accent-color) !important;
  color: var(--zb-accent-text, #ffffff) !important;
  font-weight: 600;
}
.zotero-browser-sidebar-wrapper button.zb-btn-primary:hover:not(:disabled) {
  background: var(--zb-accent-hover, var(--accent-color)) !important;
  border-color: var(--zb-accent-hover, var(--accent-color)) !important;
}
.zotero-browser-sidebar-wrapper button.zb-btn-success {
  background: var(--zb-success, #059669) !important;
  border-color: var(--zb-success, #059669) !important;
  color: #ffffff !important;
  font-weight: 600;
}
.zotero-browser-sidebar-wrapper button.zb-btn-success:hover:not(:disabled) {
  filter: brightness(1.08);
}
.zotero-browser-sidebar-wrapper input[type="text"]:not(.zb-home-query),
.zotero-browser-sidebar-wrapper select:not(.zb-home-engine),
.zotero-browser-sidebar-wrapper textarea {
  border-radius: 6px !important;
  border: 1px solid var(--material-border, #d1d5db) !important;
  background: var(--zb-input-bg, var(--material-sidepane, #ffffff)) !important;
  color: var(--fill-primary, #212529) !important;
  transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
}
.zotero-browser-sidebar-wrapper input[type="text"]:not(.zb-home-query):focus,
.zotero-browser-sidebar-wrapper select:not(.zb-home-engine):focus,
.zotero-browser-sidebar-wrapper textarea:focus {
  border-color: var(--accent-color) !important;
  box-shadow: 0 0 0 2px var(--zb-accent-soft, rgba(0, 0, 0, 0.08));
  outline: none;
}
.zotero-browser-sidebar-wrapper ::selection { background: var(--zb-selection, #dbeafe); }
.zotero-browser-sidebar-wrapper .zb-tab { transition: background 0.12s ease; }
.zotero-browser-sidebar-wrapper .zb-tab:not(.zb-tab-active):hover {
  background: var(--zb-btn-hover, var(--material-background, #f3f4f6)) !important;
}
`;
  }

  function ensureThemeStyles() {
    try {
      if (!doc.getElementById("zb-home-styles")) {
        const link = doc.createElement("link"); link.id = "zb-home-styles"; link.rel = "stylesheet";
        link.href = "chrome://zotero-browser/content/home.css";
        (doc.head || doc.documentElement).appendChild(link);
      }
      if (!doc.getElementById("zb-theme-styles")) {
        let styleEl = doc.createElement("style");
        styleEl.id = "zb-theme-styles";
        styleEl.textContent = themeStylesheet();
        (doc.head || doc.documentElement).appendChild(styleEl);
      }
    } catch (e) {}
  }

  function getThemeName() {
    try {
      if (typeof zbGetThemeName === "function") {
        return zbGetThemeName();
      }
      let name = Zotero.Prefs.get(PREF_THEME, true);
      if (name && typeof ZB_THEMES !== "undefined" && ZB_THEMES[name]) {
        return name;
      }
    } catch (e) {}
    return (typeof ZB_DEFAULT_THEME !== "undefined" && ZB_DEFAULT_THEME) || "cream";
  }

  function applyTheme(name, opts = {}) {
    if (typeof ZB_THEMES === "undefined" || !ZB_THEMES) {
      return;
    }
    if (!ZB_THEMES[name]) {
      name = (typeof ZB_DEFAULT_THEME !== "undefined" && ZB_DEFAULT_THEME) || "cream";
    }
    if (typeof zbApplyThemeToElement === "function") {
      zbApplyThemeToElement(wrapper, name);
      try {
        let panel = doc.getElementById("zotero-browser-dock");
        if (panel) {
          zbApplyThemeToElement(panel, name);
        }
      } catch (e) {}
    } else {
      let theme = ZB_THEMES[name];
      for (let key of Object.keys(theme)) {
        if (key.startsWith("--")) {
          wrapper.style.setProperty(key, theme[key]);
        }
      }
    }
    if (opts.save) {
      try {
        Zotero.Prefs.set(PREF_THEME, name, true);
      } catch (e) {}
    }
    updateThemeMenuSelection(name);
  }

  let themeMenu = null;
  let themeGallery = null;
  let themeMenuRows = [];

  function updateThemeMenuSelection(name) {
    for (let row of themeMenuRows) {
      let on = row._zbThemeId === name;
      row.setAttribute("aria-pressed", String(on));
      row.style.borderColor = on
        ? "var(--accent-color, #d97757)"
        : "var(--material-border, #d1d5db)";
      row.style.boxShadow = on ? "0 0 0 1px var(--accent-color, #d97757)" : "none";
    }
  }

  function toggleThemeMenu() {
    if (themeMenu && themeMenu.style.display === "flex") {
      themeMenu.style.display = "none";
      return;
    }
    if (!themeMenu) {
      themeMenu = doc.createElement("div");
      themeMenu.style.cssText = `
        position: absolute;
        top: 32px;
        right: 34px;
        z-index: 10002;
        display: none;
        flex-direction: column;
        gap: 4px;
        padding: 14px;
        min-width: 168px;
        width: min(420px,calc(100% - 24px));
        box-sizing: border-box;
        max-height: calc(100% - 48px);
        overflow-y: auto;
        background: var(--material-sidepane, #ffffff);
        border: 1px solid var(--material-border, #d1d5db);
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
      `;
      let caption = doc.createElement("div");
      caption.textContent = "皮肤与背景";
      caption.style.cssText = "font-size:13px;font-weight:600;color:var(--fill-secondary, #7a7263);padding:0 4px 2px;";
      const menuHeader = doc.createElement("div"); menuHeader.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;";
      const closeMenu = doc.createElement("button"); closeMenu.type = "button"; closeMenu.textContent = "×";
      closeMenu.setAttribute("aria-label", "关闭皮肤设置"); closeMenu.style.cssText = "width:24px;height:24px;padding:0;cursor:pointer;font-size:17px;";
      closeMenu.addEventListener("click", () => { themeMenu.style.display = "none"; });
      menuHeader.appendChild(caption); menuHeader.appendChild(closeMenu); themeMenu.appendChild(menuHeader);
      themeMenuRows = [];
      const colorHeading = doc.createElement("strong"); colorHeading.textContent = "界面配色";
      colorHeading.style.cssText = "font-size:12px;margin:4px 0 8px;"; themeMenu.appendChild(colorHeading);
      if (typeof ZB_THEMES !== "undefined" && ZB_THEMES) {
        const choices = zbCreateThemeChoices(doc, ZB_THEMES, id => {
          applyTheme(id, { save: true });
          showToast("已切换配色：" + (ZB_THEMES[id].label || id), "success");
        });
        themeMenu.appendChild(choices.root); themeMenuRows = choices.rows;
      }
      if (zbBackgroundService) {
        const gallery = zbBackgrounds.createGallery(doc, zbBackgroundService);
        themeGallery = gallery;
        themeMenu.appendChild(gallery.root); registerDispose(gallery.dispose);
      }
      wrapper.appendChild(themeMenu);
      updateThemeMenuSelection(getThemeName());
    }
    themeGallery?.resetPreview();
    themeMenu.style.display = "flex";
  }

  let themeOutsideClick = (e) => {
    if (themeMenu && themeMenu.style.display === "flex" &&
        !themeMenu.contains(e.target) && !e.target.closest?.(".zb-home-customize") && e.target !== btnTheme && !btnTheme.contains(e.target)) {
      themeMenu.style.display = "none";
    }
    hideTranslateUIOnClick(e);
  };
  doc.addEventListener("click", themeOutsideClick, true);
  registerDispose(() => doc.removeEventListener("click", themeOutsideClick, true));

  /* ---------- 划词翻译（复用已安装的 Translate for Zotero 插件） ---------- */
  let transCard = null;
  let autoTranslateTimer = null;
  let lastAutoTranslated = "";
  let translateSequence = 0;
  let lastCiteURL = "";

  function citeSourceFromCurrent() {
    const { libraryID, selectedCol } = getPaneSelectionInfo();
    const url = getCleanCurrentUrl();
    if (zbCitation.arxivID(url) || zbCitation.adsBibcode(url) || zbCitation.doiID(url)) {
      return zbCitation.sourceFromURL(url, libraryID, selectedCol ? [selectedCol.id] : []);
    }
    const item = Zotero.getActiveZoteroPane().getSelectedItems()[0];
    if (item) return zbCitationService.itemSource(item);
    throw new Error("请打开 arXiv PDF，输入文章链接，或在 Zotero 中选择文章");
  }

  function openCite(source) {
    if (!zbCitationService) return;
    try { source = source || citeSourceFromCurrent(); } catch (_) { source = null; }
    zbShowCitePopup(doc.defaultView, source, "browser");
  }

  function updateCiteURL(url) {
    if (!zbCitationService || url === lastCiteURL) return;
    lastCiteURL = url;
    // Navigation only invalidates the previous citation. Query and show it
    // when the user clicks Cite, including for arXiv PDF links.
    if (zbCitePopupIsOpen(doc.defaultView, "browser")) zbHideCitePopup(doc.defaultView);
    zbClearBrowserCiteSource(doc.defaultView);
  }

  function ensureTranslateUI() {
    if (transCard) {
      return;
    }
    transCard = doc.createElement("div");
    transCard.style.cssText = `
      position: absolute;
      display: none;
      z-index: 10003;
      max-width: 340px;
      min-width: 220px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--material-border, #d1d5db);
      background: var(--material-sidepane, #ffffff);
      color: var(--fill-primary, #212529);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
      font-size: 12px;
      line-height: 1.6;
    `;
    wrapper.appendChild(transCard);
  }

  function hideTranslateUIOnClick(e) {
    if (!transCard || transCard.style.display !== "block") {
      return;
    }
    if (transCard.contains(e.target)) {
      return;
    }
    transCard.style.display = "none";
  }

  function clampPopoverPos(x, y, elWidth, elHeight) {
    let maxX = Math.max(8, wrapper.clientWidth - elWidth - 8);
    let maxY = Math.max(8, wrapper.clientHeight - elHeight - 8);
    return {
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(8, y), maxY)
    };
  }

  function getTranslateApi() {
    // Translate for Zotero (zotero-pdf-translate by windingwind) exposes
    // Zotero.PDFTranslate.api.translate(raw, { pluginID }) for other plugins.
    try {
      let zpt = (typeof Zotero !== "undefined" && Zotero.PDFTranslate) || null;
      if (zpt && zpt.api && typeof zpt.api.translate === "function") {
        return {
          name: "Translate for Zotero",
          translate: async (text) => {
            let task = await zpt.api.translate(text, { pluginID: "zotero-browser@custom.plugin", langfrom: "en", langto: "zh-CN" });
            if (task && task.status === "success" && typeof task.result === "string" && task.result.trim()) {
              return task.result;
            }
            throw new Error("翻译失败" + (task && task.status ? "（" + task.status + "）" : "：结果为空"));
          }
        };
      }
    } catch (e) {}
    return null;
  }

  function showTransCard(source, result, x, y, loading, vocabularySource) {
    ensureTranslateUI();
    transCard.innerHTML = "";
    let head = doc.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;";
    let titleEl = doc.createElement("span");
    titleEl.textContent = loading ? "翻译中…" : "翻译结果";
    titleEl.style.cssText = "font-weight:600;color:var(--fill-secondary,#7a7263);font-size:11px;";
    let closeBtn = doc.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = "border:none;background:transparent;color:inherit;cursor:pointer;font-size:12px;padding:0 2px;";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      transCard.style.display = "none";
    });
    head.appendChild(titleEl);
    head.appendChild(closeBtn);

    let srcEl = doc.createElement("div");
    srcEl.textContent = source.length > 300 ? source.slice(0, 300) + "…" : source;
    srcEl.style.cssText = "color:var(--fill-secondary,#7a7263);margin-bottom:6px;max-height:80px;overflow:hidden;";

    let resEl = doc.createElement("div");
    resEl.textContent = result;
    resEl.style.cssText = loading
      ? "color:var(--fill-secondary,#7a7263);font-style:italic;"
      : "color:var(--fill-primary,#212529);max-height:220px;overflow:auto;user-select:text;";

    transCard.appendChild(head);
    transCard.appendChild(srcEl);
    transCard.appendChild(resEl);
    if (!loading && vocabularySource && zbVocabularyService) {
      zbVocabularyService.addSaveButton(doc, transCard, vocabularySource, source, result);
    }
    transCard.style.display = "block";
    let pos = clampPopoverPos(x, y + 8, 340, Math.min(transCard.offsetHeight || 120, 300));
    transCard.style.left = pos.x + "px";
    transCard.style.top = pos.y + "px";
  }

  async function runTranslate(text, x, y, vocabularySource) {
    text = (text || "").trim();
    if (!text) {
      return;
    }
    let api = getTranslateApi();
    if (!api) {
      showToast("未检测到翻译插件，请先安装 Translate for Zotero（zotero-pdf-translate）", "warn");
      return;
    }
    const sequence = ++translateSequence;
    showTransCard(text, "正在调用 " + api.name + " 翻译…", x, y, true);
    try {
      let result = await api.translate(text);
      if (sequence !== translateSequence || wrapper._zbDisposed) return;
      showTransCard(text, result, x, y, false, vocabularySource);
    } catch (e) {
      if (sequence !== translateSequence || wrapper._zbDisposed) return;
      showTransCard(text, String(e && e.message ? e.message : e), x, y, false);
    }
  }

  // 划词翻译开关：默认关闭，用户可在 ⚙ 设置中打开，状态记忆在偏好里。
  const PREF_WORD_TRANSLATION = "extensions.zotero-browser.wordTranslation";
  function isWordTranslationEnabled() {
    try {
      return Zotero.Prefs.get(PREF_WORD_TRANSLATION, true) === true;
    } catch (e) {}
    return false;
  }

  // 统一处理来自 PDF 阅读器与网页的划词上报：选中即自动翻译，无需再点按钮。
  function onSelectionFromFrame(anchorEl, text, rect, page) {
    text = (text || "").trim();
    clearTimeout(autoTranslateTimer);
    if (!text || !rect) {
      ++translateSequence;
      lastAutoTranslated = "";
      return;
    }
    if (!isWordTranslationEnabled()) {
      return;
    }
    // 只自动翻译包含拉丁字母的选区，避免选中中文/纯符号时打扰用户。
    if (!/[A-Za-z]/.test(text)) {
      return;
    }
    if (text.length > 1500) {
      text = text.slice(0, 1500);
    }
    let x;
    let y;
    try {
      let aRect = anchorEl.getBoundingClientRect();
      let wRect = wrapper.getBoundingClientRect();
      x = aRect.left - wRect.left + (rect.x || 0);
      y = aRect.top - wRect.top +
        (rect.bottom != null ? rect.bottom : (rect.y || 0) + (rect.h || 0));
    } catch (e) {
      return;
    }
    let vocabularySource = null;
    if (anchorEl === pdfFrame && currentPdfUrl && zbVocabularyService) {
      const { libraryID, selectedCol } = getPaneSelectionInfo();
      const tab = tabs.find(t => t.id === activeTabId);
      vocabularySource = zbVocabularyService.previewSource(currentPdfUrl, tab && tab.title, libraryID,
        selectedCol ? [selectedCol.id] : [], page);
    }
    const selectionKey = (vocabularySource ? vocabularySource.identity : anchorEl.id) + ":" + text;
    if (selectionKey === lastAutoTranslated) return;
    ++translateSequence;
    autoTranslateTimer = setTimeout(() => {
      if (selectionKey === lastAutoTranslated) {
        return;
      }
      lastAutoTranslated = selectionKey;
      runTranslate(text, x, y, vocabularySource);
    }, 300);
  }

  // 网页划词：由子进程 actor 上报，经 browser 元素冒泡到 wrapper。
  wrapper.addEventListener("zb-embed-selection", (event) => {
    let d = event.detail || {};
    onSelectionFromFrame(event.target, d.text || "", d.rect || null);
  }, true);

  // 人机验证卡点：由子进程 actor 检测上报；记录到对应标签页，前台时显示提示条。
  wrapper.addEventListener("zb-embed-captcha", (event) => {
    let d = event.detail || {};
    let b = event.target;
    let tab = tabs.find(t => t.browser === b);
    let url = d.url || "";
    if (d.cleared) {
      if (tab) tab.captchaInfo = null;
      if (b === browser) hideCaptchaBar();
      return;
    }
    if (tab) {
      tab.captchaInfo = { url, hasWidget: !!d.hasWidget, blocked: !!d.blocked, loop: !!d.loop, stuck: !!d.stuck };
      // 用户已手动关掉该 URL 的提示条：同一页面反复验证时不再骚扰
      if (tab.captchaDismissedUrl && tab.captchaDismissedUrl === url) {
        return;
      }
    }
    if (b === browser) {
      showCaptchaBar(b, url, !!d.hasWidget, !!d.blocked, !!d.loop, !!d.stuck);
    }
  }, true);

  const PREF_TOOLBARS_VISIBLE = "extensions.zotero-browser.toolbarsVisible";

  function loadToolbarsVisibility() {
    try {
      if (Zotero.Prefs.prefHasUserValue(PREF_TOOLBARS_VISIBLE)) {
        return Zotero.Prefs.get(PREF_TOOLBARS_VISIBLE, true) !== false;
      }
    } catch (e) {}
    return true;
  }

  function saveToolbarsVisibility(visible) {
    try {
      Zotero.Prefs.set(PREF_TOOLBARS_VISIBLE, visible, true);
    } catch (e) {}
  }

  let toolbarsVisible = loadToolbarsVisibility();

  let tabBar = doc.createElement("div");
  tabBar.style.cssText = `
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding: 3px 4px 0;
    background: var(--material-background, #e5e7eb);
    border-bottom: 1px solid var(--material-border, #d1d5db);
    flex-shrink: 0;
    min-height: 28px;
  `;
  let tabList = doc.createElement("div");
  tabList.style.cssText = "display:flex;align-items:stretch;gap:2px;flex:1;min-width:0;overflow-x:auto;";

  let btnToggleToolbars = createBtn(
    svgIcon(toolbarsVisible ? ICONS.chevronUp : ICONS.chevronDown, 13),
    toolbarsVisible ? "收起工具栏 (隐藏地址栏、操作栏和书签栏)" : "展开工具栏 (显示地址栏、操作栏和书签栏)",
    () => toggleToolbars()
  );
  btnToggleToolbars.id = "btn-toggle-toolbars";
  btnToggleToolbars.style.minWidth = "26px";
  btnToggleToolbars.style.width = "26px";
  btnToggleToolbars.style.marginBottom = "0";

  let btnTheme = createBtn(svgIcon(ICONS.palette, 14), "皮肤与背景：配色、风景图库与本地图片", () => toggleThemeMenu());
  btnTheme.id = "btn-theme";
  btnTheme.style.minWidth = "26px";
  btnTheme.style.width = "26px";
  btnTheme.style.marginBottom = "0";

  let btnSettings = createBtn(svgIcon(ICONS.gear, 14), "设置：自定义界面按钮快捷键", () => toggleSettingsPanel());
  btnSettings.id = "btn-settings";
  btnSettings.style.minWidth = "26px";
  btnSettings.style.width = "26px";
  btnSettings.style.marginBottom = "0";
  const btnCite = createBtn(zbToolbarIcon("cite", 16), "Cite · NASA ADS BibTeX：显示、复制与批量保存", () => {
    if (zbCitePopupIsOpen(doc.defaultView, "browser")) zbHideCitePopup(doc.defaultView);
    else openCite();
  });
  btnCite.setAttribute("aria-haspopup", "dialog");
  btnCite.setAttribute("aria-label", "Cite · ADS BibTeX");
  btnCite.style.width = "26px";
  btnCite.style.padding = "0";

  let btnNewTab = createBtn(svgIcon(ICONS.plus, 14), "新建标签页 (Ctrl/⌘+T)", () => addTab("about:blank", { showHome: true }));
  btnNewTab.style.minWidth = "26px";
  btnNewTab.style.marginBottom = "0";
  tabBar.appendChild(tabList);
  tabBar.appendChild(btnToggleToolbars);
  tabBar.appendChild(btnTheme);
  tabBar.appendChild(btnSettings);
  tabBar.appendChild(btnCite);
  tabBar.appendChild(btnNewTab);

  let toolbar = doc.createElement("div");
  toolbar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 6px;
    background: var(--material-background, #f3f4f6);
    border-bottom: 1px solid var(--material-border, #d1d5db);
    flex-shrink: 0;
  `;

  let btnBack = createBtn(svgIcon(ICONS.back), "后退", () => {
    if (isPdfOpen()) {
      let pdfUrl = currentPdfUrl;
      closePdfViewer(true);
      try {
        let spec = browser.currentURI && browser.currentURI.spec;
        if (pdfUrl && (!spec || zbIsPdfUrl(spec) || /^about:/.test(spec))) {
          let abs = arxivAbsFromPdf(pdfUrl);
          if (abs) {
            loadURI(abs);
          }
        }
      } catch (e) {}
      return;
    }
    try {
      if (browser.canGoBack) {
        browser.goBack();
      }
    } catch (e) {}
  });
  let btnForward = createBtn(svgIcon(ICONS.forward), "前进", () => {
    if (!isPdfOpen() && lastClosedPdfUrl) {
      openPdf(lastClosedPdfUrl);
      return;
    }
    try {
      if (browser.canGoForward) {
        browser.goForward();
      }
    } catch (e) {}
  });
  let btnReload = createBtn(svgIcon(ICONS.reload), "刷新", () => reloadCurrent());
  let btnHome = createBtn(svgIcon(ICONS.home), "主页", () => showWelcome());
  let btnStop = createBtn(svgIcon(ICONS.stop), "停止加载", () => {
    try {
      browser.stop();
    } catch (e) {}
    stopProgress();
  });

  let engineSelect = doc.createElement("select");
  engineSelect.style.cssText = `
    height: 26px;
    padding: 0 4px;
    border: 1px solid var(--material-border, #d1d5db);
    border-radius: 4px;
    background: var(--material-sidepane, #ffffff);
    color: inherit;
    font-size: 11px;
    outline: none;
    max-width: 85px;
  `;
  // Keep the native select deliberately plain-text.  Emoji prefixes were
  // rendered as mojibake by some Zotero/XUL font combinations and made the
  // engine choice ambiguous.  Older persisted values are migrated below.
  const engines = [
    { id: "google", name: "Google", url: "https://www.google.com/search?q=%s" },
    { id: "bing", name: "必应", url: "https://www.bing.com/search?q=%s" }
  ];
  const PREF_SEARCH_ENGINE = "extensions.zotero-browser.searchEngine";
  function loadSearchEngine() {
    let raw = "";
    try {
      raw = String(Zotero.Prefs.get(PREF_SEARCH_ENGINE, true) || "").trim().toLowerCase();
    } catch (e) {}
    // Accept a couple of old localized values, but persist only stable IDs.
    let aliases = { "谷歌": "google", "google": "google", "必应": "bing", "bing": "bing" };
    let id = aliases[raw] || "";
    if (!engines.some(e => e.id === id)) {
      id = "google";
    }
    try {
      if (raw !== id) {
        Zotero.Prefs.set(PREF_SEARCH_ENGINE, id, true);
      }
    } catch (e) {}
    return id;
  }
  let selectedSearchEngine = loadSearchEngine();
  engines.forEach(eng => {
    let opt = doc.createElement("option");
    opt.value = eng.id;
    opt.textContent = eng.name;
    engineSelect.appendChild(opt);
  });
  engineSelect.value = selectedSearchEngine;
  engineSelect.addEventListener("change", () => {
    let id = engines.some(e => e.id === engineSelect.value) ? engineSelect.value : "google";
    selectedSearchEngine = id;
    engineSelect.value = id;
    homeSearch.engine.value = id;
    try {
      Zotero.Prefs.set(PREF_SEARCH_ENGINE, id, true);
    } catch (e) {}
  });

  let urlInput = doc.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "输入网址或关键词直接搜索...";
  urlInput.style.cssText = `
    flex: 1;
    min-width: 50px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--material-border, #d1d5db);
    border-radius: 4px;
    background: var(--material-sidepane, #ffffff);
    color: inherit;
    font-size: 11px;
    outline: none;
  `;

  let btnGo = createBtn(svgIcon(ICONS.go), "前往", () => handleSearchOrUrl());
  urlInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearchOrUrl();
    }
  });

  toolbar.appendChild(btnBack);
  toolbar.appendChild(btnForward);
  toolbar.appendChild(btnReload);
  toolbar.appendChild(btnStop);
  toolbar.appendChild(btnHome);
  toolbar.appendChild(engineSelect);
  toolbar.appendChild(urlInput);
  toolbar.appendChild(btnGo);

  let actionBar = doc.createElement("div");
  actionBar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: var(--material-background, #f3f4f6);
    border-bottom: 1px solid var(--material-border, #d1d5db);
    flex-shrink: 0;
    overflow-x: auto;
    white-space: nowrap;
  `;

  let btnSave = createBtn(svgIcon(ICONS.save, 13) + "<span>保存到 Zotero</span>", "将当前文献/网页完整保存到 Zotero", async () => {
    await saveCurrentPageToZotero(false);
  });
  btnSave.classList.add("zb-btn-primary");

  let btnOpenInReader = createBtn(svgIcon(ICONS.book, 13) + "<span>保存并用 Reader 打开</span>", "明确保存到 Zotero 后，再用官方 PDF Reader 打开", async () => {
    await saveCurrentPageToZotero(true);
  });
  btnOpenInReader.classList.add("zb-btn-success");

  let btnCookie = createBtn(svgIcon(ICONS.cookie, 13) + "<span>导入 Cookie</span>", "导入 Chrome/Edge 等其他浏览器的登录 Cookie", () => {
    toggleCookieModal();
  });

  let btnAddBookmark = createBtn(svgIcon(ICONS.star, 13) + "<span>收藏</span>", "收藏当前页", () => {
    addCurrentBookmark();
  });

  let btnExternal = createBtn(svgIcon(ICONS.external, 13) + "<span>外部打开</span>", "在默认浏览器中打开", () => {
    let currentTargetUrl = getCleanCurrentUrl();
    if (currentTargetUrl && currentTargetUrl !== "about:blank") {
      Zotero.launchURL(currentTargetUrl);
    }
  });

  actionBar.appendChild(btnSave);
  actionBar.appendChild(btnOpenInReader);
  actionBar.appendChild(btnCookie);
  actionBar.appendChild(btnAddBookmark);
  actionBar.appendChild(btnExternal);

  let bookmarksBar = doc.createElement("div");
  bookmarksBar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px;
    background: var(--material-background, #f3f4f6);
    border-bottom: 1px solid var(--material-border, #d1d5db);
    overflow-x: auto;
    white-space: nowrap;
    scrollbar-width: thin;
    flex-shrink: 0;
  `;

  let progressTrack = doc.createElement("div");
  progressTrack.style.cssText = `
    height: 2px;
    width: 100%;
    background: transparent;
    flex-shrink: 0;
    overflow: hidden;
  `;
  let progressBar = doc.createElement("div");
  progressBar.style.cssText = `
    height: 100%;
    width: 0%;
    background: var(--accent-color, #2563eb);
    opacity: 0;
    transition: width 0.12s linear, opacity 0.2s ease;
  `;
  progressTrack.appendChild(progressBar);

  let viewport = doc.createElement("div");
  viewport.style.cssText = `
    flex: 1 1 auto;
    height: 100%;
    min-height: ${scope === "dock" ? "0" : "900px"};
    position: relative;
    width: 100%;
    overflow: hidden;
    background: #ffffff;
  `;

  function createBrowserElement() {
    let b = doc.createXULElement ? doc.createXULElement("browser") : doc.createElement("browser");
    b.setAttribute("type", "content");
    b.setAttribute("flex", "1");
    b.setAttribute("remote", "true");
    b.setAttribute("disableglobalhistory", "true");
    b.setAttribute("maychangeremoteness", "true");
    b.setAttribute("autofind", "true");
    try {
      b.setAttribute("messagemanagergroup", "zotero-browser");
    } catch (e) {}
    b.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      min-height: 0;
      border: none;
      background-color: #ffffff;
      display: block;
    `;
    return b;
  }

  let tabs = [];
  let activeTabId = null;
  let nextTabId = 1;
  let browser = createBrowserElement();

  let welcomeView = doc.createElement("div");
  welcomeView.className = "zb-home-view";
  welcomeView.style.cssText = `
    position: absolute;
    inset: 0;
    z-index: 8;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: clamp(32px,10vh,96px) 16px 64px;
    box-sizing: border-box;
    overflow: auto;
    background: var(--material-sidepane, #ffffff);
  `;
  welcomeView.innerHTML = `
    <div class="zb-home-content" style="max-width:560px;width:100%;text-align:center;">
      <div id="zb-quick-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;text-align:left;"></div>
    </div>
  `;
  const homeSearch = zbCreateHomeSearch(doc, {
    engines, getEngine: () => engineSelect.value,
    setEngine: id => {
      engineSelect.value = id;
      engineSelect.dispatchEvent(new doc.defaultView.Event("change"));
    },
    submit: value => handleSearchOrUrl(value)
  });
  welcomeView.firstElementChild.prepend(homeSearch.root);
  if (zbBackgroundService) {
    registerDispose(zbBackgroundService.subscribe(value => zbBackgrounds.apply(welcomeView, zbBackgroundService, value)));
  }
  const customizeHome = doc.createElement("button"); customizeHome.type = "button";
  customizeHome.className = "zb-home-customize";
  customizeHome.innerHTML = svgIcon(ICONS.palette, 14) + "<span>自定义背景</span>";
  customizeHome.addEventListener("click", event => { event.stopPropagation(); toggleThemeMenu(); });
  welcomeView.appendChild(customizeHome);
  const PREF_HOME_SITES = "extensions.zotero-browser.homeSites";
  const DEFAULT_HOME_SITES = [
    { name: "📑 arXiv", desc: "预印本文库", url: "https://arxiv.org" },
    { name: "📺 Bilibili", desc: "B 站", url: "https://www.bilibili.com" },
    { name: "✨ INSPIRE", desc: "高能物理文献", url: "https://inspirehep.net" },
    { name: "💬 ChatGPT", desc: "AI 助手", url: "https://chatgpt.com" },
    { name: "📝 Overleaf", desc: "在线 LaTeX", url: "https://www.overleaf.com" },
    { name: "🚀 arXiv q-cs", desc: "arXiv 镜像", url: "https://arxiv.q-cs.cn" }
  ];
  // Keep this feature entry visible even when an existing user has a
  // persisted custom home list from an older plugin version.
  const FEATURED_HOME_SITES = [
    {
      name: "🚀 Google Antigravity",
      desc: "Web 界面 · antigravity.google.com",
      url: "https://antigravity.google.com/",
      featured: true
    }
  ];
  let quickGrid = welcomeView.querySelector("#zb-quick-grid");

  function loadHomeSites() {
    try {
      let json = Zotero.Prefs.get(PREF_HOME_SITES, true);
      if (json) {
        let parsed = JSON.parse(json);
        if (Array.isArray(parsed)) {
          return parsed.filter(site => site && site.name && /^https?:\/\//i.test(site.url || ""));
        }
      }
    } catch (e) {}
    return DEFAULT_HOME_SITES.map(site => ({ ...site }));
  }

  function saveHomeSites(list) {
    try {
      Zotero.Prefs.set(PREF_HOME_SITES, JSON.stringify(list), true);
    } catch (e) {}
  }

  function addHomeSite() {
    let nameValue = { value: "" };
    let urlValue = { value: "https://" };
    let win = doc.defaultView;
    if (!Services.prompt.prompt(win, "添加主页网站", "网站名称：", nameValue, null, {})) {
      return;
    }
    if (!nameValue.value.trim()) {
      return;
    }
    if (!Services.prompt.prompt(win, "添加主页网站", "网站地址：", urlValue, null, {})) {
      return;
    }
    let url = urlValue.value.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url.replace(/^\/+/, "");
    }
    try {
      Services.io.newURI(url);
    } catch (e) {
      showToast("网站地址格式无效", "error");
      return;
    }
    let list = loadHomeSites();
    list.push({ name: nameValue.value.trim(), desc: "自定义网站", url });
    saveHomeSites(list);
    renderHomeSites();
  }

  function renderHomeSites() {
    quickGrid.innerHTML = "";
    let persisted = loadHomeSites();
    let list = FEATURED_HOME_SITES.concat(
      persisted.filter(site => !FEATURED_HOME_SITES.some(featured =>
        String(featured.url).replace(/\/$/, "") === String(site.url).replace(/\/$/, "")))
    );
    list.forEach((site, idx) => {
      let tile = doc.createElement("div");
      tile.className = "zb-home-tile";
      tile.tabIndex = 0; tile.setAttribute("role", "link"); tile.title = site.name;
      tile.style.cssText = `
        position: relative;
        border: 1px solid var(--material-border, #d1d5db);
        border-radius: 8px;
        padding: 8px 27px 8px 10px;
        cursor: pointer;
        background: var(--material-background, #f8fafc);
        min-height: 34px;
      `;
      let name = doc.createElement("div");
      name.textContent = site.name;
      name.style.cssText = "font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      let desc = doc.createElement("div");
      desc.textContent = site.desc || site.url;
      desc.className = "zb-home-tile-description";
      desc.style.cssText = "font-size:11px;color:var(--fill-secondary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      let remove = null;
      if (!site.featured) {
        remove = doc.createElement("button");
        remove.textContent = "×";
        remove.title = "从主页删除";
        remove.style.cssText = "position:absolute;right:5px;top:5px;width:19px;height:19px;padding:0;border:none;border-radius:50%;background:transparent;color:#94a3b8;cursor:pointer;font-size:15px;line-height:18px;";
        remove.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          let saved = loadHomeSites();
          let target = saved.findIndex(item => item && item.url === site.url && item.name === site.name);
          if (target >= 0) {
            saved.splice(target, 1);
            saveHomeSites(saved);
            renderHomeSites();
            showToast("已从主页删除", "info");
          }
        });
      }
      tile.addEventListener("click", () => navigate(site.url));
      tile.addEventListener("keydown", event => { if (event.target === tile && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); navigate(site.url); } });
      tile.appendChild(name);
      tile.appendChild(desc);
      if (remove) {
        tile.appendChild(remove);
      }
      quickGrid.appendChild(tile);
    });

    let addTile = doc.createElement("button");
    addTile.className = "zb-home-add-site";
    addTile.textContent = "+ 添加网站";
    addTile.title = "向主页添加自定义网站";
    addTile.style.cssText = "min-height:52px;border:1px dashed #94a3b8;border-radius:8px;background:transparent;color:#64748b;cursor:pointer;font-size:11px;";
    addTile.addEventListener("click", addHomeSite);
    quickGrid.appendChild(addTile);
  }

  // Use a XUL browser plus a frame-script bridge. Current Zotero builds may
  // hide contentWindow even for non-remote browser elements, while the browser
  // message manager remains stable for large ArrayBuffer transfers.
  let pdfFrame = doc.createXULElement ? doc.createXULElement("browser") : doc.createElement("browser");
  pdfFrame.setAttribute("type", "content");
  pdfFrame.setAttribute("remote", "false");
  pdfFrame.setAttribute("maychangeremoteness", "false");
  pdfFrame.setAttribute("disableglobalhistory", "true");
  pdfFrame.setAttribute("messagemanagergroup", "zotero-browser-pdf");
  pdfFrame.style.cssText = `
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
    display: none;
    z-index: 12;
    background: #525659;
  `;
  try {
    pdfFrame.setAttribute("src", "about:blank");
  } catch (e) {}

  let pdfFallback = doc.createElement("div");
  pdfFallback.style.cssText = `
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: none;
    z-index: 13;
    overflow: auto;
    background: #525659;
    padding: 12px 0 24px;
  `;

  let currentPdfUrl = null;
  let lastClosedPdfUrl = null;
  let lastPdfBuffer = null;
  let pdfFrameReady = false;
  let pdfMessageManager = null;
  let pdfBridgeInstalled = false;
  let pendingPdfMessage = null;
  let openingPdfUrl = null;
  let openingPdfAt = 0;

  function isPdfOpen() {
    let tab = currentTab();
    return !!(tab && tab.pdfOpen && (currentPdfUrl || tab.pdfUrl));
  }

  function hideWelcome() {
    welcomeView.style.display = "none";
    let tab = currentTab();
    if (tab) {
      tab.homeOpen = false;
    }
  }

  function showWelcome() {
    let tab = currentTab();
    if (tab) {
      tab.homeOpen = true;
    }
    closePdfViewer(false);
    try {
      browser.stop();
    } catch (e) {}
    renderHomeSites();
    try {
      viewport.appendChild(welcomeView);
    } catch (e) {}
    welcomeView.style.display = "flex";
    urlInput.value = "";
    currentPdfUrl = null;
    tab = currentTab();
    if (tab) {
      tab.title = "主页";
      tab.url = "about:blank";
      tab.pdfUrl = "";
      tab.pdfOpen = false;
      tab.pdfBuffer = null;
      tab.pdfClosedUrl = null;
    }
    renderTabBar();
    stopProgress();
  }

  function closePdfViewer(keepHistory) {
    if (isPdfOpen() && currentPdfUrl && keepHistory) {
      lastClosedPdfUrl = currentPdfUrl;
    }
    pdfFrame.style.display = "none";
    pdfFallback.style.display = "none";
    pdfFallback.innerHTML = "";
    try {
      pdfFrame.setAttribute("src", "about:blank");
    } catch (e) {}
    let tab = currentTab();
    if (tab) {
      tab.pdfOpen = false;
      if (keepHistory) {
        tab.pdfClosedUrl = currentPdfUrl || tab.pdfUrl;
      }
      tab.pdfUrl = "";
    }
    currentPdfUrl = null;
    sendPdfCommand({ type: "zb-pdf-close" });
  }

  function sendPdfCommand(payload) {
    if (pdfMessageManager) {
      try {
        pdfMessageManager.sendAsyncMessage("zb-pdf-command", payload);
        return true;
      } catch (e) {
        dump("[Zotero Browser] PDF message manager: " + e + "\n");
      }
    }
    let win = pdfContentWindow();
    try {
      if (win) {
        win.postMessage(payload, "*");
        return true;
      }
    } catch (e) {}
    return false;
  }

  function sendPdfToFrame(payload) {
    if (!pdfFrameReady) {
      pendingPdfMessage = { payload };
      return false;
    }
    return sendPdfCommand(payload);
  }

  pdfFrame.addEventListener("load", () => {
    setupPdfMessageBridge();
  });

  function pdfContentWindow() {
    try {
      return pdfFrame.contentWindow || null;
    } catch (e) {
      return null;
    }
  }

  const PREF_PDF_ZOOM = "extensions.zotero-browser.pdfZoom";
  const PREF_PDF_FITWIDTH = "extensions.zotero-browser.pdfFitWidth";

  function savePdfZoomState(d) {
    try {
      if (!d) {
        return;
      }
      if (d.fitWidth) {
        Zotero.Prefs.set(PREF_PDF_FITWIDTH, true, true);
        return;
      }
      let z = parseFloat(d.zoom);
      if (isFinite(z) && z >= 0.3 && z <= 4) {
        Zotero.Prefs.set(PREF_PDF_FITWIDTH, false, true);
        Zotero.Prefs.set(PREF_PDF_ZOOM, String(z), true);
      }
    } catch (e) {}
  }

  // 把记忆的缩放状态拼到阅读器 URL 上，阅读器加载时据此恢复。
  function getPdfZoomQuery() {
    try {
      if (!Zotero.Prefs.prefHasUserValue(PREF_PDF_FITWIDTH) &&
          !Zotero.Prefs.prefHasUserValue(PREF_PDF_ZOOM)) {
        return "";
      }
      let fit = Zotero.Prefs.get(PREF_PDF_FITWIDTH, true) !== false;
      if (fit) {
        return "&fit=1";
      }
      let z = parseFloat(Zotero.Prefs.get(PREF_PDF_ZOOM, true));
      if (isFinite(z) && z >= 0.3 && z <= 4) {
        return "&fit=0&z=" + z;
      }
    } catch (e) {}
    return "";
  }

  function handlePdfBridgeEvent(data) {
    if (!data || typeof data.type !== "string") {
      return;
    }
    if (data.type === "zb-pdf-ready") {
      pdfFrameReady = true;
      if (pendingPdfMessage) {
        let pending = pendingPdfMessage;
        pendingPdfMessage = null;
        sendPdfCommand(pending.payload);
      }
      return;
    }
    if (data.type === "zb-pdf-error") {
      stopProgress();
      pdfFrame.style.display = "none";
      pdfFallback.style.display = "block";
      pdfFallback.textContent = "无法打开这份 PDF：" + (data.message || "内置阅读器错误");
      showToast("PDF 打开失败", "error");
      return;
    }
    if (data.type === "zb-pdf-openlink") {
      // Same event may arrive via window.postMessage AND the message-manager
      // bridge; dedupe so we never open the same link twice.
      let now = Date.now();
      if (wrapper._zbLastOpenlink === data.url && now - (wrapper._zbLastOpenlinkAt || 0) < 800) {
        return;
      }
      wrapper._zbLastOpenlink = data.url;
      wrapper._zbLastOpenlinkAt = now;
      if (data.url && /^https?:/i.test(data.url)) {
        // 后台新标签页打开，不打断当前 PDF 阅读。
        addTab(data.url, { activate: false });
        showToast("已在新标签页打开链接: " + data.url.slice(0, 60), "info");
      }
      return;
    }
    if (data.type === "zb-pdf-debug") {
      // 诊断信息仅写控制台，不再弹 toast 打扰用户。
      try {
        dump("[Zotero Browser PDF] " + (data.message || "") + "\n");
      } catch (e) {}
      return;
    }
    if (data.type === "zb-pdf-zoomstate") {
      savePdfZoomState(data);
      return;
    }
    if (data.type === "zb-pdf-selection") {
      onSelectionFromFrame(pdfFrame, data.text || "", data.rect || null, data.page || null);
      return;
    }
  }

  function setupPdfMessageBridge() {
    // Online preview loads Zotero's bundled PDF.js viewer directly. No byte
    // bridge is needed, and nothing is imported into the Zotero library.
  }

  function ensurePdfFrame(src) {
    let target = src || "resource://zotero-browser/content/pdf-viewer.html";
    let current = "";
    try {
      current = pdfFrame.getAttribute("src") || "";
    } catch (e) {}
    if (current === target) {
      setupPdfMessageBridge();
      return;
    }
    pdfFrameReady = false;
    setupPdfMessageBridge();
    try {
      pdfFrame.setAttribute("src", target);
    } catch (e) {
      dump("[Zotero Browser] pdf iframe src error: " + e + "\n");
    }
  }

  function waitForPdfFrame(ms) {
    if (pdfFrameReady) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let finished = false;
      let timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          resolve(false);
        }
      }, ms);
      let poll = setInterval(() => {
        if (pdfFrameReady && !finished) {
          finished = true;
          clearTimeout(timer);
          clearInterval(poll);
          resolve(true);
        }
      }, 40);
    });
  }

  function copyBytes(buffer) {
    let n = buffer && buffer.byteLength ? buffer.byteLength : 0;
    let copy = new Uint8Array(n);
    let view = new Uint8Array(buffer);
    for (let i = 0; i < n; i++) {
      copy[i] = view[i];
    }
    return copy;
  }

  async function openWithEmbeddedPdfViewer(buffer, url) {
    pendingPdfMessage = null;
    pdfFallback.style.display = "none";
    pdfFrame.style.display = "block";
    ensurePdfFrame("resource://zotero-browser/content/pdf-viewer.html");
    if (!await waitForPdfFrame(15000)) {
      throw new Error("内置 PDF 阅读器初始化超时");
    }
    let copy = copyBytes(buffer);
    if (!sendPdfToFrame({ type: "zb-pdf-open", buffer: copy.buffer, url })) {
      throw new Error("无法把 PDF 数据发送给内置阅读器");
    }
  }

  async function openPdf(rawUrl) {
    let url = String(rawUrl || "").trim();
    if (!url || !zbIsPdfUrl(url)) {
      return;
    }
    if (openingPdfUrl === url && (Date.now() - openingPdfAt) < 1500) {
      return;
    }
    openingPdfUrl = url;
    openingPdfAt = Date.now();
    BrowserHub.notePdfIntent(url);

    try {
      let spec = browser.currentURI && browser.currentURI.spec;
      if (spec && zbIsPdfUrl(spec)) {
        try {
          browser.stop();
        } catch (e2) {}
      }
    } catch (e) {}

    hideWelcome();
    currentPdfUrl = url;
    updateCiteURL(url);
    lastClosedPdfUrl = null;
    lastPdfBuffer = null;
    urlInput.value = url;
    pdfFallback.style.display = "none";
    pdfFrame.style.display = "none";
    startProgress(true);

    let tab = currentTab();
    if (tab) {
      tab.pdfOpen = true;
      tab.pdfUrl = url;
      tab.pdfBuffer = null;
      tab.url = url;
      tab.title = (url.split("/").pop() || "PDF").replace(/[?#].*$/, "");
    }
    renderTabBar();

    let viewerUrl = "resource://zotero-browser/content/pdf-viewer.html?file=" +
      encodeURIComponent(url) + getPdfZoomQuery();
    try {
      loadURI(viewerUrl);
      showToast("正在在线预览 PDF；不会保存到 Zotero", "info");
    } catch (err) {
      stopProgress();
      openingPdfUrl = null;
      openingPdfAt = 0;
      showToast("在线 PDF 预览启动失败", "error");
    }
  }

  function copyToLocalBuffer(src) {
    if (typeof zbCopyToLocalBuffer === "function") {
      try {
        return zbCopyToLocalBuffer(src);
      } catch (e) {}
    }
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
      let view = new Uint8Array(src);
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

  function looksLikePdf(buffer) {
    try {
      if (!buffer || buffer.byteLength < 5) {
        return false;
      }
      let u8 = new Uint8Array(buffer);
      let limit = Math.min(u8.length - 4, 1024);
      for (let i = 0; i <= limit; i++) {
        if (u8[i] === 0x25 && u8[i + 1] === 0x50 && u8[i + 2] === 0x44 && u8[i + 3] === 0x46) {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async function blobToArrayBuffer(blob) {
    if (!blob) {
      return null;
    }
    if (typeof blob.arrayBuffer === "function") {
      return await blob.arrayBuffer();
    }
    return await new Promise((resolve, reject) => {
      let reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  function rewriteArxivPdfUrl(url) {
    let m = String(url || "").match(/arxiv\.org\/pdf\/([0-9]+\.[0-9]+(?:v[0-9]+)?|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})(?:\.pdf)?/i);
    if (!m) {
      return [url];
    }
    let id = m[1].replace(/\.pdf$/i, "");
    return [
      url,
      `https://arxiv.org/pdf/${id}`,
      `https://arxiv.org/pdf/${id}.pdf`,
      `https://export.arxiv.org/pdf/${id}`
    ].filter((item, idx, arr) => arr.indexOf(item) === idx);
  }

  function xhrPdfBuffer(url) {
    return new Promise((resolve, reject) => {
      try {
        let xhr = new XMLHttpRequest();
        xhr.mozBackgroundRequest = true;
        xhr.open("GET", url, true);
        xhr.responseType = "arraybuffer";
        xhr.timeout = 120000;
        try {
          xhr.setRequestHeader("Accept", "application/pdf,*/*");
          xhr.setRequestHeader("X-Zotero-Browser-Internal", "1");
        } catch (e) {}
        xhr.onload = function () {
          if (xhr.status && xhr.status >= 400) {
            reject(new Error("HTTP " + xhr.status));
            return;
          }
          try {
            resolve(copyToLocalBuffer(xhr.response));
          } catch (e) {
            reject(e);
          }
        };
        xhr.onerror = function () {
          reject(new Error("xhr network error"));
        };
        xhr.ontimeout = function () {
          reject(new Error("xhr timeout"));
        };
        xhr.send();
      } catch (e) {
        reject(e);
      }
    });
  }

  async function readPathToBuffer(path) {
    if (typeof IOUtils !== "undefined" && IOUtils.read) {
      let bytes = await IOUtils.read(path);
      return copyToLocalBuffer(bytes);
    }
    let file = Components.classes["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    let fstream = Components.classes["@mozilla.org/network/file-input-stream;1"]
      .createInstance(Ci.nsIFileInputStream);
    fstream.init(file, -1, 0, 0);
    let bis = Components.classes["@mozilla.org/binaryinputstream;1"]
      .createInstance(Ci.nsIBinaryInputStream);
    bis.setInputStream(fstream);
    let size = file.fileSize;
    let piece = new ArrayBuffer(size);
    bis.readArrayBuffer(size, piece);
    try {
      bis.close();
    } catch (e) {}
    try {
      fstream.close();
    } catch (e) {}
    return copyToLocalBuffer(piece);
  }

  async function fetchPdfBuffer(url) {
    let errors = [];
    let candidates = rewriteArxivPdfUrl(url);

    function accept(buffer, via) {
      if (!buffer || !buffer.byteLength) {
        throw new Error(via + ": empty");
      }
      if (looksLikePdf(buffer)) {
        return buffer;
      }
      throw new Error(via + ": not a PDF (" + buffer.byteLength + " bytes)");
    }

    for (let candidate of candidates) {
      if (typeof zbFetchPdfBuffer === "function") {
        try {
          let buffer = accept(copyToLocalBuffer(await zbFetchPdfBuffer(candidate)), "netutil");
          return buffer;
        } catch (e) {
          errors.push("netutil " + e);
        }
      }

      try {
        let buffer = accept(await xhrPdfBuffer(candidate), "xhr");
        return buffer;
      } catch (e) {
        errors.push("xhr " + e);
      }

      try {
        if (Zotero.HTTP && Zotero.HTTP.download && typeof PathUtils !== "undefined") {
          let tmp = PathUtils.join(PathUtils.tempDir, "zb-pdf-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".pdf");
          await Zotero.HTTP.download(candidate, tmp, {
            timeout: 120000,
            headers: {
              Accept: "application/pdf,*/*",
              "X-Zotero-Browser-Internal": "1"
            }
          });
          let buffer = accept(await readPathToBuffer(tmp), "download");
          try {
            if (typeof IOUtils !== "undefined") {
              await IOUtils.remove(tmp);
            }
          } catch (e2) {}
          return buffer;
        }
      } catch (e) {
        errors.push("download " + e);
      }

      try {
        if (Zotero.HTTP && Zotero.HTTP.request) {
          let req = await Zotero.HTTP.request("GET", candidate, {
            responseType: "arraybuffer",
            timeout: 120000,
            headers: {
              Accept: "application/pdf,*/*",
              "X-Zotero-Browser-Internal": "1"
            },
            successCodes: false
          });
          let status = req.status || 0;
          if (status && status >= 400) {
            throw new Error("HTTP " + status);
          }
          let payload = req.response;
          if (payload && typeof Blob !== "undefined" && Object.prototype.toString.call(payload) === "[object Blob]") {
            payload = await blobToArrayBuffer(payload);
          }
          let buffer = accept(copyToLocalBuffer(payload), "request");
          return buffer;
        }
      } catch (e) {
        errors.push("request " + e);
      }
    }
    throw new Error("无法下载 PDF：" + (errors.join(" | ") || "无可用通道"));
  }

  function loadURI(targetUrl, flags) {
    let opts = {
      triggeringPrincipal: SYSTEM_PRINCIPAL,
      loadFlags: flags || Ci.nsIWebNavigation.LOAD_FLAGS_NONE
    };
    try {
      if (browser.fixupAndLoadURIString) {
        browser.fixupAndLoadURIString(targetUrl, opts);
        return;
      }
    } catch (e) {}
    try {
      let uri = Services.io.newURI(targetUrl);
      browser.loadURI(uri, opts);
      return;
    } catch (e) {}
    try {
      browser.setAttribute("src", targetUrl);
    } catch (e2) {}
  }

  function navigate(targetUrl) {
    if (!targetUrl) {
      return;
    }
    let actualUrl = String(targetUrl).trim();
    if (actualUrl.startsWith("/")) {
      actualUrl = "https://arxiv.org" + actualUrl;
    }
    if (zbIsPdfUrl(actualUrl)) {
      openPdf(actualUrl);
      return;
    }

    closePdfViewer(false);
    hideWelcome();
    urlInput.value = actualUrl;
    try {
      browser.stop();
    } catch (e) {}
    startProgress(true);
    loadURI(actualUrl);
  }

  function arxivAbsFromPdf(url) {
    let m = String(url || "").match(/arxiv\.org\/pdf\/([0-9]+\.[0-9]+(?:v[0-9]+)?|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})/i);
    if (!m) {
      return null;
    }
    return "https://arxiv.org/abs/" + m[1].replace(/\.pdf$/i, "");
  }

  let lastEmbedNavigateUrl = "";
  let lastEmbedNavigateAt = 0;

  // PDF 阅读器里点击的链接统一走这里：后台新标签页打开，不离开当前 PDF，
  // 阅读器（页数/缩放工具栏）保持原样。
  function openPdfViewerLink(url) {
    if (!url || !/^https?:/i.test(url)) {
      return;
    }
    let now = Date.now();
    if (wrapper._zbLastPdfLink === url && now - (wrapper._zbLastPdfLinkAt || 0) < 800) {
      return;
    }
    wrapper._zbLastPdfLink = url;
    wrapper._zbLastPdfLinkAt = now;
    addTab(url, { activate: false });
    showToast("已在新标签页打开链接: " + url.slice(0, 60), "info");
  }

  function handleEmbedNavigate(url, isPdf, newTab) {
    if (!url) {
      return;
    }
    let now = Date.now();
    if (url === lastEmbedNavigateUrl && now - lastEmbedNavigateAt < 750) {
      return;
    }
    lastEmbedNavigateUrl = url;
    lastEmbedNavigateAt = now;
    let absUrl = url;
    if (absUrl.startsWith("/")) {
      try {
        let base = browser.currentURI && browser.currentURI.spec;
        absUrl = Services.io.newURI(absUrl, null, Services.io.newURI(base || "https://arxiv.org/")).spec;
      } catch (e) {
        absUrl = "https://arxiv.org" + absUrl;
      }
    }
    if (newTab) {
      addTab(absUrl);
      return;
    }
    if (isPdf || zbIsPdfUrl(absUrl)) {
      openPdf(absUrl);
    } else {
      navigate(absUrl);
    }
  }

  function reloadCurrent() {
    if (isPdfOpen() && currentPdfUrl) {
      let url = currentPdfUrl;
      currentPdfUrl = null;
      openingPdfUrl = null;
      openPdf(url);
      return;
    }
    try {
      if (browser.reloadWithFlags) {
        browser.reloadWithFlags(Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE);
        startProgress(true);
        return;
      }
    } catch (e) {}
    let url = getCleanCurrentUrl();
    if (url && url !== "about:blank") {
      navigate(url);
    }
  }

  function getCleanCurrentUrl() {
    if (currentPdfUrl) {
      return currentPdfUrl;
    }
    let raw = (browser.currentURI && browser.currentURI.spec) ? browser.currentURI.spec : urlInput.value;
    // 内置阅读器页面的地址是 pdf-viewer.html?file=<真实地址>，保存时还原真实地址
    if (raw && /pdf-viewer\.html\?file=/i.test(raw)) {
      try {
        let m = raw.match(/[?&]file=([^&]+)/);
        if (m && m[1]) {
          return decodeURIComponent(m[1]);
        }
      } catch (e) {}
    }
    if (raw && raw.includes("docs.google.com/viewer") && raw.includes("url=")) {
      try {
        let match = raw.match(/url=([^&]+)/);
        if (match && match[1]) {
          return decodeURIComponent(match[1]);
        }
      } catch (e) {}
    }
    return raw;
  }

  function handleSearchOrUrl(value = urlInput.value) {
    let input = value.trim();
    if (!input) {
      return;
    }
    const urlPattern = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i;
    const localhostPattern = /^(https?:\/\/)?localhost(:\d+)?(\/.*)?$/i;
    let targetUrl = "";
    if (input.startsWith("http://") || input.startsWith("https://") || input.startsWith("file://")) {
      targetUrl = input;
    } else if (urlPattern.test(input) || localhostPattern.test(input)) {
      targetUrl = "https://" + input;
    } else {
      let eng = engines.find(e => e.id === engineSelect.value) || engines[0];
      targetUrl = eng.url.replace("%s", encodeURIComponent(input));
    }
    navigate(targetUrl);
  }

  let progressTimer = null;
  function startProgress(reset) {
    if (reset) {
      progressBar.style.transition = "none";
      progressBar.style.width = "8%";
      progressBar.style.opacity = "1";
      progressBar.offsetHeight;
      progressBar.style.transition = "width 0.12s linear, opacity 0.2s ease";
    }
    progressBar.style.opacity = "1";
    if (progressTimer) {
      clearTimeout(progressTimer);
    }
    progressTimer = setTimeout(stopProgress, 12000);
  }

  function updateProgress(percent) {
    progressBar.style.opacity = "1";
    progressBar.style.width = Math.max(8, Math.min(92, percent)) + "%";
  }

  function stopProgress() {
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    progressBar.style.width = "100%";
    setTimeout(() => {
      progressBar.style.opacity = "0";
      progressBar.style.width = "0%";
    }, 180);
  }

  function makeProgressListener(b) {
    return {
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
      onLocationChange(aWebProgress, aRequest, aLocation) {
        if (!aWebProgress || !aWebProgress.isTopLevel) {
          return;
        }
        let spec = aLocation && aLocation.spec;
        let tab = tabs.find(t => t.browser === b);
        // 页面发生跳转（含验证通过后跳转）时，清除该标签页的人机验证标记
        if (tab) {
          tab.captchaInfo = null;
          if (tab.captchaDismissedUrl && spec !== tab.captchaDismissedUrl) {
            tab.captchaDismissedUrl = null;
          }
        }
        if (captchaBar && captchaBar._browser === b) {
          hideCaptchaBar();
        }
        let isOnlinePdfViewer = !!(spec &&
          spec.startsWith("resource://zotero-browser/content/pdf-viewer.html"));
        if (tab && spec && spec !== "about:blank" &&
            !(tab.pdfOpen && isOnlinePdfViewer)) {
          tab.url = spec;
          tab.homeOpen = false;
          try {
            tab.title = b.contentTitle || spec;
          } catch (e) {
            tab.title = spec;
          }
          if (tab.popupPending) {
            tab.popupPending = false;
            if (tab.id !== activeTabId) {
              activateTab(tab.id);
            }
          }
        }
        if (spec && zbIsPdfUrl(spec)) {
          try {
            if (aRequest && aRequest.cancel) {
              aRequest.cancel(Cr.NS_BINDING_ABORTED);
            }
          } catch (e) {}
          if (tab && tab.id !== activeTabId) {
            activateTab(tab.id);
          }
          openPdf(spec);
          renderTabBar();
          return;
        }
        if (b === browser && spec && spec !== "about:blank") {
          urlInput.value = isPdfOpen() ? (currentPdfUrl || (tab && tab.pdfUrl) || "") : spec;
          if (!isOnlinePdfViewer) updateCiteURL(spec);
        }
        renderTabBar();
      },
      onStateChange(aWebProgress, aRequest, aStateFlags) {
        if (!aWebProgress || !aWebProgress.isTopLevel) {
          return;
        }
        const nsIWebProgressListener = Ci.nsIWebProgressListener;
        let isNetwork = aStateFlags & nsIWebProgressListener.STATE_IS_NETWORK;
        let isWindow = aStateFlags & nsIWebProgressListener.STATE_IS_WINDOW;
        if (!(isNetwork || isWindow)) {
          return;
        }
        if (aStateFlags & nsIWebProgressListener.STATE_START) {
          let requestSpec = "";
          try {
            let channel = aRequest && aRequest.QueryInterface(Ci.nsIChannel);
            let spec = channel && channel.URI && channel.URI.spec;
            requestSpec = spec || "";
            if (spec && zbIsPdfUrl(spec)) {
              aRequest.cancel(Cr.NS_BINDING_ABORTED);
              if (b !== browser) {
                let tab = tabs.find(t => t.browser === b);
                if (tab) {
                  activateTab(tab.id);
                }
              }
              openPdf(spec);
              return;
            }
          } catch (e) {}
          if (b === browser) {
            let tab = currentTab();
            if (!(tab && tab.homeOpen) && requestSpec !== "about:blank") {
              hideWelcome();
              startProgress(true);
            }
          }
        }
        if ((aStateFlags & nsIWebProgressListener.STATE_STOP) && b === browser) {
          stopProgress();
          openingPdfUrl = null;
          openingPdfAt = 0;
        }
      },
      onProgressChange(_webProgress, _request, _curSelf, _maxSelf, curTotal, maxTotal) {
        if (b === browser && maxTotal > 0) {
          updateProgress((curTotal / maxTotal) * 90);
        }
      },
      onStatusChange() {},
      onSecurityChange() {},
      onContentBlockingEvent() {}
    };
  }

  function attachLegacyFrameBridge(b) {
    if (!b || b._zbLegacyFrameBridgeAttached) {
      return;
    }
    try {
      if (!b.messageManager || !b.messageManager.loadFrameScript) {
        return;
      }
      b.messageManager.loadFrameScript(
        "chrome://zotero-browser/content/frame-script.js",
        true
      );
      b._zbLegacyFrameMessageListener = (msg) => {
        let data = msg.data || {};
        if (data.fromPdfViewer) {
          openPdfViewerLink(data.url);
          return;
        }
        if (b !== browser && !data.newTab) {
          let tab = tabs.find(t => t.browser === b);
          if (tab) {
            activateTab(tab.id);
          }
        }
        handleEmbedNavigate(data.url, data.pdf, data.newTab);
      };
      b.messageManager.addMessageListener(
        "zb-navigate",
        b._zbLegacyFrameMessageListener
      );
      b._zbLegacyFrameSelectionListener = (msg) => {
        let data = msg.data || {};
        onSelectionFromFrame(b, data.text || "", data.rect || null);
      };
      b.messageManager.addMessageListener(
        "zb-selection",
        b._zbLegacyFrameSelectionListener
      );
      b._zbLegacyFrameZoomListener = (msg) => {
        savePdfZoomState(msg.data || {});
      };
      b.messageManager.addMessageListener(
        "zb-pdf-zoomstate",
        b._zbLegacyFrameZoomListener
      );
      b._zbLegacyPageZoomListener = msg => { if (b === browser) zoomCurrentPage(msg.data?.command); };
      b.messageManager.addMessageListener("zb-page-zoom", b._zbLegacyPageZoomListener);
      b._zbLegacyFrameBridgeAttached = true;
    } catch (e) {
      dump("[Zotero Browser] frame script attach failed: " + e + "\n");
    }
  }

  function attachBrowserEngine(b) {
    if (!b || b._zbEngineAttached) {
      return;
    }
    b._zbEngineAttached = true;
    b.addEventListener("zb-embed-zoom", event => {
      if (b === browser) zoomCurrentPage(event.detail?.command);
    });
    try {
      b.setAttribute("messagemanagergroup", "zotero-browser");
    } catch (e) {}
    let flags = Ci.nsIWebProgress.NOTIFY_ALL;
    try {
      b.addProgressListener(makeProgressListener(b), flags);
    } catch (e) {
      try {
        b.addProgressListener(
          makeProgressListener(b),
          Ci.nsIWebProgress.NOTIFY_STATE_NETWORK |
          Ci.nsIWebProgress.NOTIFY_LOCATION |
          Ci.nsIWebProgress.NOTIFY_PROGRESS
        );
      } catch (e2) {}
    }
    b.addEventListener("zb-embed-navigate", (event) => {
      let detail = event.detail || {};
      if (detail.fromPdfViewer) {
        openPdfViewerLink(detail.url);
        return;
      }
      if (b !== browser) {
        let tab = tabs.find(t => t.browser === b);
        if (tab && !detail.newTab) {
          activateTab(tab.id);
        }
      }
      handleEmbedNavigate(detail.url, detail.pdf, detail.newTab);
    });
    attachLegacyFrameBridge(b);
    try {
      b.addEventListener("pagetitlechanged", () => {
        let tab = tabs.find(t => t.browser === b);
        if (!tab) {
          return;
        }
        try {
          tab.title = b.contentTitle || tab.url || "新标签页";
        } catch (e) {}
        renderTabBar();
      });
    } catch (e) {}
  }

  function currentTab() {
    return tabs.find(t => t.id === activeTabId) || tabs[0] || null;
  }

  async function zoomCurrentPage(command) {
    if (recordingShortcut || !["in", "out", "reset"].includes(command)) return;
    const tab = currentTab();
    try {
      let value;
      if (tab?.pdfOpen) {
        // PDF fit-to-width would undo native page zoom on resize; use the viewer's scale.
        let target = null;
        try {
          const win = tab.browser.contentWindow; target = win?.wrappedJSObject || win;
        } catch (_) {}
        if (typeof target?.zbZoomPdfPage === "function") value = target.zbZoomPdfPage(command);
        else {
          const actor = tab.browser.browsingContext.currentWindowGlobal.getActor("ZoteroBrowserEmbed");
          value = await actor.sendQuery("PDFZoom", { command });
        }
        if (!Number.isFinite(value)) throw new Error("PDF not ready");
        tab.pageZoom = value;
      } else value = zbZoom.apply(tab, welcomeView.firstElementChild, command);
      if (value !== null && tab === currentTab()) showToast("页面缩放：" + Math.round(value * 100) + "%", "success");
    } catch (_) { if (tab === currentTab()) showToast("当前页面暂时无法缩放", "error"); }
  }

  function snapshotActiveTabPdf() {
    let tab = currentTab();
    if (!tab) {
      return;
    }
    tab.pdfUrl = currentPdfUrl || "";
    tab.pdfOpen = isPdfOpen();
    tab.pdfBuffer = lastPdfBuffer;
    tab.pdfClosedUrl = lastClosedPdfUrl;
    try {
      if (!tab.pdfOpen && browser) {
        tab.url = (browser.currentURI && browser.currentURI.spec) || tab.url;
        tab.title = browser.contentTitle || tab.title;
      }
    } catch (e) {}
  }

  function renderTabBar() {
    if (!tabList) {
      return;
    }
    tabList.innerHTML = "";
    tabs.forEach((t) => {
      let chip = doc.createElement("div");
      let active = t.id === activeTabId;
      chip.className = "zb-tab" + (active ? " zb-tab-active" : "");
      chip.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 168px;
        min-width: 72px;
        padding: 4px 6px;
        cursor: pointer;
        border: 1px solid var(--material-border, #d1d5db);
        border-bottom: none;
        border-radius: 6px 6px 0 0;
        background: ${active ? "var(--material-sidepane, #ffffff)" : "transparent"};
        font-size: 11px;
        flex-shrink: 0;
      `;
      let label = doc.createElement("span");
      let name = t.title || t.url || "新标签页";
      if (name.length > 22) {
        name = name.substring(0, 20) + "…";
      }
      label.textContent = (t.pdfOpen ? "📄 " : "") + name;
      label.title = t.url || "";
      label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;";
      chip.addEventListener("click", () => activateTab(t.id));
      let x = doc.createElement("span");
      x.textContent = "×";
      x.title = "关闭标签页";
      x.style.cssText = "color:#888;font-weight:bold;padding:0 2px;";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(t.id);
      });
      chip.appendChild(label);
      chip.appendChild(x);
      tabList.appendChild(chip);
    });
  }

  function activateTab(id, opts = {}) {
    let tab = tabs.find(t => t.id === id);
    if (!tab) {
      return;
    }
    if (!opts.skipSnapshot && activeTabId != null && activeTabId !== id) {
      snapshotActiveTabPdf();
    }
    activeTabId = tab.id;
    browser = tab.browser;
    welcomeView.firstElementChild.style.zoom = String(tab.pageZoom || 1);
    tabs.forEach((t) => {
      let on = t.id === tab.id;
      try {
        t.browser.hidden = !on;
      } catch (e) {}
      t.browser.style.visibility = on ? "visible" : "hidden";
      t.browser.style.zIndex = on ? "1" : "0";
    });
    currentPdfUrl = tab.pdfUrl || null;
    updateCiteURL(tab.pdfUrl || tab.url || "");
    lastPdfBuffer = tab.pdfBuffer || null;
    lastClosedPdfUrl = tab.pdfClosedUrl || null;
    urlInput.value = tab.pdfUrl || tab.url || "";
    if (tab.pdfOpen && tab.pdfUrl) {
      welcomeView.style.display = "none";
      pdfFrame.style.display = "none";
      pdfFallback.style.display = "none";
      urlInput.value = tab.pdfUrl;
    } else {
      pdfFrame.style.display = "none";
      pdfFallback.style.display = "none";
      if (tab.homeOpen || !tab.url || tab.url === "about:blank") {
        renderHomeSites();
        try {
          viewport.appendChild(welcomeView);
        } catch (e) {}
        welcomeView.style.display = "flex";
      } else {
        welcomeView.style.display = "none";
      }
    }
    if (tab.captchaInfo && tab.captchaDismissedUrl !== tab.captchaInfo.url) {
      showCaptchaBar(tab.browser, tab.captchaInfo.url, tab.captchaInfo.hasWidget, tab.captchaInfo.blocked, tab.captchaInfo.loop, tab.captchaInfo.stuck);
    } else {
      hideCaptchaBar();
    }
    renderTabBar();
  }

  function activateBrowser(b) {
    let tab = tabs.find(t => t.browser === b);
    if (tab) {
      activateTab(tab.id);
    }
  }

  function addTab(url, opts = {}) {
    let target = url || "about:blank";
    let wantsHome = opts.showHome === true ||
      (opts.showHome !== false && (!url || target === "about:blank"));
    if (opts.reuseBrowser) {
      let tab = {
        id: nextTabId++,
        browser: opts.reuseBrowser,
        title: opts.title || "主页",
        url: target,
        pdfUrl: "",
        pdfOpen: false,
        pdfBuffer: null,
        pdfClosedUrl: null,
        homeOpen: wantsHome,
        pageZoom: 1,
        popupPending: !!opts.popup
      };
      tabs.push(tab);
      activeTabId = tab.id;
      browser = tab.browser;
      renderTabBar();
      if (wantsHome) {
        showWelcome();
      }
      return tab;
    }
    snapshotActiveTabPdf();
    let b = createBrowserElement();
    try {
      viewport.insertBefore(b, pdfFrame);
    } catch (e) {
      viewport.appendChild(b);
    }
    attachBrowserEngine(b);
    try {
      if (wrapper._zbPopupHandler) {
        b.addEventListener("DOMPopupBlocked", wrapper._zbPopupHandler, true);
      }
    } catch (e) {}
    let tab = {
      id: nextTabId++,
      browser: b,
      title: opts.title || "新标签页",
      url: target,
      pdfUrl: "",
      pdfOpen: false,
      pdfBuffer: null,
      pdfClosedUrl: null,
      homeOpen: wantsHome,
      pageZoom: 1,
      popupPending: !!opts.popup
    };
    tabs.push(tab);
    if (opts.activate === false) {
      // 后台标签页（如 PDF 阅读器中点击的参考文献链接）：直接在新标签的
      // browser 里加载，不切换当前标签、不打断 PDF 阅读。
      try {
        b.hidden = true;
      } catch (e) {}
      b.style.visibility = "hidden";
      b.style.zIndex = "0";
      if (!wantsHome && target && target !== "about:blank") {
        try {
          let uri = Services.io.newURI(target);
          b.loadURI(uri, { triggeringPrincipal: SYSTEM_PRINCIPAL });
        } catch (e) {}
      }
      renderTabBar();
      return tab;
    }
    activateTab(tab.id, { skipSnapshot: true });
    if (wantsHome) {
      showWelcome();
    } else if (zbIsPdfUrl(target)) {
      openPdf(target);
    } else {
      navigate(target);
    }
    renderTabBar();
    return tab;
  }

  function closeTab(id) {
    if (tabs.length <= 1) {
      showWelcome();
      let only = tabs[0];
      if (only) {
        only.title = "主页";
        only.url = "about:blank";
        renderTabBar();
      }
      return;
    }
    let idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) {
      return;
    }
    let tab = tabs[idx];
    try {
      tab.browser.stop();
    } catch (e) {}
    try {
      tab.browser.remove();
    } catch (e) {}
    tabs.splice(idx, 1);
    if (activeTabId === id) {
      let next = tabs[Math.min(idx, tabs.length - 1)];
      activateTab(next.id, { skipSnapshot: true });
    } else {
      renderTabBar();
    }
  }

  attachBrowserEngine(browser);

  const PREF_BOOKMARKS = "extensions.zotero-browser.bookmarks";
  function loadBookmarks() {
    let list = [{ name: "📑 arXiv", url: "https://arxiv.org" }];
    try {
      let json = Zotero.Prefs.get(PREF_BOOKMARKS, true);
      if (json) {
        let parsed = JSON.parse(json);
        if (Array.isArray(parsed) && parsed.length > 0) {
          list = parsed;
        }
      }
    } catch (e) {}
    return list;
  }

  function saveBookmarks(list) {
    try {
      Zotero.Prefs.set(PREF_BOOKMARKS, JSON.stringify(list), true);
    } catch (e) {}
  }

  function renderBookmarks() {
    bookmarksBar.innerHTML = "";
    let list = loadBookmarks();
    list.forEach((bm, idx) => {
      let chip = doc.createElement("div");
      chip.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 6px;
        background: var(--material-sidepane, #ffffff);
        border: 1px solid var(--material-border, #d1d5db);
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
        user-select: none;
      `;
      let titleSpan = doc.createElement("span");
      titleSpan.textContent = bm.name;
      titleSpan.title = bm.url;
      titleSpan.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.button === 1) {
          addTab(bm.url);
        } else {
          navigate(bm.url);
        }
      });
      let delBtn = doc.createElement("span");
      delBtn.textContent = "×";
      delBtn.title = "删除此书签";
      delBtn.style.cssText = "color:#888;font-weight:bold;font-size:12px;margin-left:2px;cursor:pointer;";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        list.splice(idx, 1);
        saveBookmarks(list);
        renderBookmarks();
        showToast("已删除书签", "info");
      });
      chip.appendChild(titleSpan);
      chip.appendChild(delBtn);
      bookmarksBar.appendChild(chip);
    });
  }

  function addCurrentBookmark() {
    let currentTargetUrl = getCleanCurrentUrl();
    if (!currentTargetUrl || currentTargetUrl === "about:blank") {
      showToast("请先打开网页再收藏", "error");
      return;
    }
    let title = browser.contentTitle || currentTargetUrl;
    if (title.length > 20) {
      title = title.substring(0, 18) + "...";
    }
    let list = loadBookmarks();
    if (!list.some(b => b.url === currentTargetUrl)) {
      list.push({ name: `⭐ ${title}`, url: currentTargetUrl });
      saveBookmarks(list);
      renderBookmarks();
      showToast(`已收藏：「${title}」`, "success");
    } else {
      showToast("该网页已在书签列表中", "info");
    }
  }

  let cookieModal = doc.createElement("div");
  cookieModal.style.cssText = `
    position: absolute;
    top: 55px;
    left: 8px;
    right: 8px;
    max-height: 82vh;
    overflow-y: auto;
    background: var(--material-sidepane, #ffffff);
    border: 1px solid var(--material-border, #d1d5db);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.22);
    padding: 14px;
    z-index: 10000;
    display: none;
    flex-direction: column;
    gap: 10px;
  `;

  let cookieModalHeader = doc.createElement("div");
  cookieModalHeader.style.cssText = "display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--material-border, #e5e7eb); padding-bottom: 8px;";
  let cookieTitle = doc.createElement("div");
  cookieTitle.innerHTML = "<strong style='font-size: 13px;'>🍪 Cookie 导入与跨浏览器登录同步指南</strong>";
  let cookieCloseBtn = createBtn("✕ 关闭", "关闭面板", () => {
    cookieModal.style.display = "none";
  });
  cookieModalHeader.appendChild(cookieTitle);
  cookieModalHeader.appendChild(cookieCloseBtn);

  let tutorialBox = doc.createElement("div");
  tutorialBox.style.cssText = `
    font-size: 11px;
    color: var(--text-secondary, #374151);
    line-height: 1.6;
    background: var(--material-background, #f9fafb);
    border: 1px solid var(--material-border, #e5e7eb);
    border-radius: 6px;
    padding: 10px 12px;
  `;
  tutorialBox.innerHTML = `
    <div style="font-weight: 600; color: #2563eb; margin-bottom: 4px;">从本机浏览器自动导入，或继续手动粘贴</div>
    <div>范围可选“当前域名”或“全部网站”。Chrome / Edge 在 macOS 上可能弹出钥匙串授权；Firefox 不需要解密。Safari 读取的是只读 Cookies.binarycookies，文件权限失败时可用下方“选择 Safari 文件”回退。二进制文件通常只包含持久化 Cookie，不能保证完整迁移登录态；若 Cookie 使用设备绑定或短期会话，仍需在站点重新登录。</div>
    <div style="margin-top:4px;">手动方式也支持一次粘贴包含多个域名的完整 Cookie JSON；<code>name=value</code> 文本因不含域名，只能按上方域名导入。</div>
  `;

  let cookieDomainRow = doc.createElement("div");
  cookieDomainRow.style.cssText = "display: flex; align-items: center; gap: 6px;";
  let cookieDomainLabel = doc.createElement("span");
  cookieDomainLabel.textContent = "作用域名:";
  cookieDomainLabel.style.fontWeight = "600";
  let cookieDomainInput = doc.createElement("input");
  cookieDomainInput.type = "text";
  cookieDomainInput.placeholder = "如 .arxiv.org / .google.com";
  cookieDomainInput.style.cssText = `
    flex: 1;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--material-border, #d1d5db);
    border-radius: 4px;
    font-size: 11px;
    background: var(--material-sidepane, #ffffff);
    color: inherit;
  `;
  cookieDomainRow.appendChild(cookieDomainLabel);
  cookieDomainRow.appendChild(cookieDomainInput);

  let autoCookieRow = doc.createElement("div");
  autoCookieRow.style.cssText = "display:flex;align-items:center;gap:6px;padding:8px;border:1px solid var(--material-border,#e5e7eb);border-radius:6px;background:var(--material-background,#f8fafc);";
  let autoCookieLabel = doc.createElement("span");
  autoCookieLabel.textContent = "本机来源:";
  autoCookieLabel.style.fontWeight = "600";
  // 自定义下拉：原生 <select> 在 Zotero 侧栏里会被 Zotero 全局样式破坏
  // （选项堆叠渲染、互相重叠且遮挡点击），改用按钮 + 弹层列表实现。
  function makeCookieDropdown(minWidth) {
    let current = null;
    let box = doc.createElement("div");
    box.style.cssText = "position:relative;flex:1;min-width:" + (minWidth || 120) + "px;";
    let btn = doc.createElement("button");
    btn.type = "button";
    btn.style.cssText = "width:100%;height:26px;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:0 8px;border:1px solid var(--material-border,#d1d5db);border-radius:4px;background:var(--material-sidepane,#fff);color:inherit;font-size:11px;cursor:pointer;box-sizing:border-box;";
    let btnLabel = doc.createElement("span");
    btnLabel.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;";
    btnLabel.textContent = "…";
    let btnArrow = doc.createElement("span");
    btnArrow.textContent = "▾";
    btn.appendChild(btnLabel);
    btn.appendChild(btnArrow);
    let listEl = doc.createElement("div");
    listEl.style.cssText = "display:none;position:absolute;top:28px;left:0;right:0;z-index:10005;max-height:170px;overflow-y:auto;background:var(--material-sidepane,#fff);border:1px solid var(--material-border,#d1d5db);border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,0.16);";
    let hideList = () => {
      listEl.style.display = "none";
    };
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      listEl.style.display = listEl.style.display === "none" ? "block" : "none";
    });
    let closeCookieDropdown = (e) => {
      if (!box.contains(e.target)) {
        hideList();
      }
    };
    doc.addEventListener("click", closeCookieDropdown, true);
    registerDispose(() => doc.removeEventListener("click", closeCookieDropdown, true));
    box.appendChild(btn);
    box.appendChild(listEl);
    return {
      element: box,
      getValue: () => current,
      setDisabled: (d) => {
        btn.disabled = !!d;
        btn.style.opacity = d ? "0.55" : "1";
      },
      setItems: (items, emptyLabel) => {
        listEl.innerHTML = "";
        current = null;
        if (!items.length) {
          btnLabel.textContent = emptyLabel || "（无选项）";
          hideList();
          return;
        }
        for (let item of items) {
          let row = doc.createElement("button");
          row.type = "button";
          row.textContent = item.label;
          row.style.cssText = "display:block;width:100%;text-align:left;padding:5px 9px;border:0;background:transparent;color:inherit;font-size:11px;cursor:pointer;";
          row.addEventListener("mouseenter", () => {
            row.style.background = "var(--material-button, #eef2f7)";
          });
          row.addEventListener("mouseleave", () => {
            row.style.background = "transparent";
          });
          row.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            current = item.value;
            btnLabel.textContent = item.label;
            hideList();
          });
          listEl.appendChild(row);
        }
        current = items[0].value;
        btnLabel.textContent = items[0].label;
      }
    };
  }

  let autoCookieSourceDropdown = makeCookieDropdown(150);
  let autoCookieScopeDropdown = makeCookieDropdown(86);
  autoCookieScopeDropdown.element.style.flex = "0 0 auto";
  autoCookieScopeDropdown.element.title = "选择自动导入范围";
  autoCookieScopeDropdown.setItems([
    { value: "domain", label: "当前域名" },
    { value: "all", label: "全部网站" }
  ]);
  let autoCookieButton = createBtn("自动导入并刷新", "从选定的本机浏览器配置中导入当前域名 Cookie", () => {
    autoImportCookies();
  });
  autoCookieButton.classList.add("zb-btn-success");
  autoCookieRow.appendChild(autoCookieLabel);
  autoCookieRow.appendChild(autoCookieSourceDropdown.element);
  autoCookieRow.appendChild(autoCookieScopeDropdown.element);
  autoCookieRow.appendChild(autoCookieButton);

  let safariFileRow = doc.createElement("div");
  safariFileRow.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px dashed var(--material-border,#d1d5db);border-radius:6px;background:var(--material-background,#fafafa);";
  let safariFileHint = doc.createElement("span");
  safariFileHint.textContent = "Safari 找不到或无权限时：";
  safariFileHint.style.cssText = "font-size:11px;color:#6b7280;flex:1;";
  let safariFileButton = createBtn("选择 Safari 文件", "手动选择 Cookies.binarycookies 文件，不会修改 Safari", () => {
    chooseSafariCookieFile();
  });
  safariFileRow.appendChild(safariFileHint);
  safariFileRow.appendChild(safariFileButton);

  let cookieTextarea = doc.createElement("textarea");
  cookieTextarea.placeholder = `在此粘贴从其他浏览器导出的 Cookie（JSON 格式或 name=value; 格式）...`;
  cookieTextarea.style.cssText = `
    width: 100%;
    height: 85px;
    padding: 6px;
    border: 1px solid var(--material-border, #d1d5db);
    border-radius: 4px;
    font-size: 11px;
    font-family: monospace;
    background: var(--material-sidepane, #ffffff);
    color: inherit;
    resize: vertical;
    box-sizing: border-box;
  `;

  let cookieActionRow = doc.createElement("div");
  cookieActionRow.style.cssText = "display: flex; gap: 6px; justify-content: flex-end; align-items: center;";

  let btnPasteClipboard = createBtn("📋 从剪贴板粘贴", "直接粘贴剪贴板内容", async () => {
    try {
      let text = "";
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        text = await navigator.clipboard.readText();
      }
      if (text) {
        cookieTextarea.value = text;
        showToast("已从剪贴板读取", "info");
      }
    } catch (e) {
      showToast("请直接在文本框中按 Cmd/Ctrl+V 粘贴", "info");
    }
  });

  let btnApplyCookie = createBtn("📥 导入并刷新页面", "写入 Cookie 并刷新当前网页", () => {
    applyImportedCookies();
  });
  btnApplyCookie.classList.add("zb-btn-primary");

  cookieActionRow.appendChild(btnPasteClipboard);
  cookieActionRow.appendChild(btnApplyCookie);
  cookieModal.appendChild(cookieModalHeader);
  cookieModal.appendChild(tutorialBox);
  cookieModal.appendChild(cookieDomainRow);
  cookieModal.appendChild(autoCookieRow);
  cookieModal.appendChild(safariFileRow);
  cookieModal.appendChild(cookieTextarea);
  cookieModal.appendChild(cookieActionRow);

  let autoCookieSources = [];
  let detectingCookieSources = false;

  function normalizeCookieDomain(value) {
    let raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    try {
      let withScheme = /^https?:\/\//i.test(raw) ? raw : "https://" + raw.replace(/^\.+/, "");
      raw = new URL(withScheme).hostname;
    } catch (e) {
      raw = raw.split("/")[0];
    }
    return raw.replace(/^www\./i, "").replace(/^\.+/, "").replace(/[^a-z0-9._-]/gi, "");
  }

  async function pathExists(path) {
    try {
      return !!(path && await IOUtils.exists(path));
    } catch (e) {
      return false;
    }
  }

  function cookieDomainMatches(host, selectedDomain) {
    let hostValue = String(host || "").trim().toLowerCase().replace(/^\.+/, "");
    let domainValue = normalizeCookieDomain(selectedDomain).toLowerCase().replace(/^\.+/, "");
    if (!hostValue || !domainValue) {
      return false;
    }
    // Match an exact host or a subdomain label.  A suffix check alone would
    // incorrectly include evilgoogle.com for a google.com selection.
    return hostValue === domainValue || hostValue.endsWith("." + domainValue);
  }

  function homePath() {
    try {
      if (PathUtils.homeDir) {
        return PathUtils.homeDir;
      }
    } catch (e) {}
    return Services.dirsvc.get("Home", Ci.nsIFile).path;
  }

  async function addChromiumCookieSources(list, browserName, basePath, keychainService, keychainAccount) {
    if (!await pathExists(basePath)) {
      return;
    }
    let profiles = [];
    try {
      profiles = await IOUtils.getChildren(basePath);
    } catch (e) {}
    profiles.sort((a, b) => {
      let an = PathUtils.filename(a);
      let bn = PathUtils.filename(b);
      if (an === "Default") return -1;
      if (bn === "Default") return 1;
      return an.localeCompare(bn);
    });
    for (let profilePath of profiles) {
      let profileName = PathUtils.filename(profilePath);
      if (profileName !== "Default" && !/^Profile /i.test(profileName)) {
        continue;
      }
      let dbPath = PathUtils.join(profilePath, "Network", "Cookies");
      if (!await pathExists(dbPath)) {
        dbPath = PathUtils.join(profilePath, "Cookies");
      }
      if (await pathExists(dbPath)) {
        list.push({
          type: "chromium",
          browserName,
          profileName,
          dbPath,
          keychainService,
          keychainAccount
        });
      }
    }
  }

  async function addSafariCookieSource(list, path, profileName) {
    if (!await pathExists(path)) {
      return;
    }
    if (list.some(source => source.type === "safari" && source.path === path)) {
      return;
    }
    list.push({
      type: "safari",
      browserName: "Safari",
      profileName: profileName || "Cookies.binarycookies",
      path
    });
  }

  async function addSafariCookieSources(list, home) {
    if (!Zotero.isMac) {
      return;
    }
    let candidates = [
      [PathUtils.join(home, "Library", "Cookies", "Cookies.binarycookies"), "Safari（常规）"],
      [PathUtils.join(home, "Library", "Containers", "com.apple.Safari", "Data", "Library", "Cookies", "Cookies.binarycookies"), "Safari（容器）"],
      [PathUtils.join(home, "Library", "Containers", "com.apple.SafariTechnologyPreview", "Data", "Library", "Cookies", "Cookies.binarycookies"), "Safari Technology Preview"],
      [PathUtils.join(home, "Library", "Group Containers", "group.com.apple.Safari", "Library", "Cookies", "Cookies.binarycookies"), "Safari（Group Container）"]
    ];
    for (let [path, profileName] of candidates) {
      await addSafariCookieSource(list, path, profileName);
    }

    // Safari 14+ profiles place one Cookies.binarycookies file below each
    // profile directory.  Enumerate only these known profile roots so a
    // permission error remains bounded and easy to explain to the user.
    let profileRoots = [
      PathUtils.join(home, "Library", "Containers", "com.apple.Safari", "Data", "Library", "Safari", "Profiles"),
      PathUtils.join(home, "Library", "Containers", "com.apple.SafariTechnologyPreview", "Data", "Library", "Safari", "Profiles"),
      PathUtils.join(home, "Library", "Group Containers", "group.com.apple.Safari", "Library", "Safari", "Profiles")
    ];
    for (let root of profileRoots) {
      if (!await pathExists(root)) {
        continue;
      }
      try {
        let profiles = await IOUtils.getChildren(root);
        for (let profilePath of profiles) {
          let profileName = PathUtils.filename(profilePath);
          await addSafariCookieSource(
            list,
            PathUtils.join(profilePath, "Cookies", "Cookies.binarycookies"),
            "Safari Profile " + profileName
          );
          await addSafariCookieSource(
            list,
            PathUtils.join(profilePath, "Cookies.binarycookies"),
            "Safari Profile " + profileName
          );
        }
      } catch (e) {
        // Detection is best effort; the file picker below is the explicit
        // fallback when the container is protected by macOS privacy controls.
        dump("[Zotero Browser] Safari profile detection: " + e + "\n");
      }
    }
  }

  async function chooseSafariCookieFile() {
    let pickerClass = null;
    try {
      pickerClass = Cc["@mozilla.org/filepicker;1"];
    } catch (e) {}
    if (!pickerClass || !Ci.nsIFilePicker) {
      showToast("当前 Zotero 版本没有文件选择器，请把 Cookies.binarycookies 复制到可读位置后重试", "error");
      return;
    }
    try {
      let picker = pickerClass.createInstance(Ci.nsIFilePicker);
      picker.init(doc.defaultView, "选择 Safari Cookies.binarycookies", Ci.nsIFilePicker.modeOpen);
      picker.appendFilter("Safari Cookies", "*.binarycookies");
      picker.appendFilters(Ci.nsIFilePicker.filterAll);
      let result = await new Promise(resolve => {
        picker.open(rv => resolve({ rv, file: picker.file }));
      });
      if (!result || result.rv !== Ci.nsIFilePicker.returnOK || !result.file || !result.file.path) {
        return;
      }
      let path = result.file.path;
      if (!await pathExists(path)) {
        showToast("选择的 Safari Cookie 文件不可读，请检查文件权限或复制后再试", "error");
        return;
      }
      let source = {
        type: "safari",
        browserName: "Safari",
        profileName: "手动选择",
        path
      };
      autoCookieSources = [source].concat(autoCookieSources.filter(item => item.path !== path));
      autoCookieSourceDropdown.setItems(autoCookieSources.map((item, index) => ({
        value: String(index),
        label: `${item.browserName} — ${item.profileName}`
      })));
      autoCookieSourceDropdown.setDisabled(false);
      autoCookieButton.disabled = false;
      showToast("已选择 Safari Cookie 文件；请选择范围后点击“自动导入并刷新”", "info");
    } catch (e) {
      showToast("选择 Safari Cookie 文件失败：" + (e && e.message ? e.message : e) + "。可先复制文件到有权限的位置再选择", "error");
    }
  }

  async function detectLocalCookieSources() {
    if (detectingCookieSources) {
      return;
    }
    detectingCookieSources = true;
    autoCookieSourceDropdown.setItems([], "正在检测本机浏览器…");
    autoCookieSourceDropdown.setDisabled(true);
    autoCookieButton.disabled = true;

    let found = [];
    try {
      let home = homePath();
      if (Zotero.isMac) {
        await addChromiumCookieSources(
          found,
          "Chrome",
          PathUtils.join(home, "Library", "Application Support", "Google", "Chrome"),
          "Chrome Safe Storage",
          "Chrome"
        );
        await addChromiumCookieSources(
          found,
          "Microsoft Edge",
          PathUtils.join(home, "Library", "Application Support", "Microsoft Edge"),
          "Microsoft Edge Safe Storage",
          "Microsoft Edge"
        );
        let firefoxBase = PathUtils.join(home, "Library", "Application Support", "Firefox", "Profiles");
        if (await pathExists(firefoxBase)) {
          let profiles = await IOUtils.getChildren(firefoxBase);
          for (let profilePath of profiles) {
            let dbPath = PathUtils.join(profilePath, "cookies.sqlite");
            if (await pathExists(dbPath)) {
              found.push({
                type: "firefox",
                browserName: "Firefox",
                profileName: PathUtils.filename(profilePath),
                dbPath
              });
            }
          }
        }
        await addSafariCookieSources(found, home);
      }
    } catch (e) {
      dump("[Zotero Browser] cookie source detection: " + e + "\n");
    }

    autoCookieSources = found;
    if (!found.length) {
      autoCookieSourceDropdown.setItems([], "未检测到受支持的浏览器配置");
      autoCookieSourceDropdown.setDisabled(true);
      autoCookieButton.disabled = true;
      safariFileHint.textContent = "未检测到可读浏览器配置；可手动选择 Safari Cookies.binarycookies：";
    } else {
      autoCookieSourceDropdown.setItems(found.map((source, index) => ({
        value: String(index),
        label: `${source.browserName} — ${source.profileName}`
      })));
      autoCookieSourceDropdown.setDisabled(false);
      autoCookieButton.disabled = false;
      if (found.some(source => source.type === "safari")) {
        safariFileHint.textContent = "Safari 文件已检测；权限失败时可手动选择：";
      } else {
        safariFileHint.textContent = "未检测到 Safari 文件；可手动选择 Cookies.binarycookies：";
      }
    }
    detectingCookieSources = false;
  }

  function hexToBytes(hex) {
    let clean = String(hex || "");
    let bytes = new doc.defaultView.Uint8Array(Math.floor(clean.length / 2));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  async function chromiumDecryptionKey(source) {
    if (!Zotero.isMac) {
      throw new Error("当前自动解密仅支持 macOS；请使用下方手动导入");
    }
    let password = "";
    let attempts = [];
    if (source.keychainAccount) {
      attempts.push([
        "find-generic-password", "-w", "-a", source.keychainAccount,
        "-s", source.keychainService
      ]);
    }
    attempts.push(["find-generic-password", "-w", "-s", source.keychainService]);
    for (let args of attempts) {
      try {
        password = await Zotero.Utilities.Internal.subprocess("/usr/bin/security", args);
        password = String(password || "").replace(/[\r\n]+$/, "");
        if (password) {
          break;
        }
      } catch (e) {}
    }
    if (!password) {
      throw new Error(`无法从 macOS 钥匙串读取 ${source.browserName} Safe Storage 密钥`);
    }
    let cryptoObject = doc.defaultView.crypto;
    let encoder = new doc.defaultView.TextEncoder();
    let material = await cryptoObject.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return await cryptoObject.subtle.deriveKey(
      { name: "PBKDF2", salt: encoder.encode("saltysalt"), iterations: 1003, hash: "SHA-1" },
      material,
      { name: "AES-CBC", length: 128 },
      false,
      ["decrypt"]
    );
  }

  async function decryptChromiumCookie(row, key) {
    if (row.value !== undefined && row.value !== null && String(row.value) !== "") {
      return String(row.value);
    }
    let encrypted = hexToBytes(row.encrypted_hex);
    if (encrypted.length < 4) {
      return "";
    }
    let prefix = String.fromCharCode(encrypted[0], encrypted[1], encrypted[2]);
    if (prefix === "v20") {
      let err = new Error("浏览器使用了 v20 应用绑定加密");
      err.code = "V20";
      throw err;
    }
    if (prefix !== "v10" && prefix !== "v11") {
      throw new Error("不支持的 Cookie 加密格式");
    }
    let iv = new doc.defaultView.Uint8Array(16);
    iv.fill(0x20);
    let cipher = encrypted.slice(3);
    let plain = await doc.defaultView.crypto.subtle.decrypt(
      { name: "AES-CBC", iv },
      key,
      cipher
    );
    let bytes = new doc.defaultView.Uint8Array(plain);
    if (Number(row.db_version || 0) >= 24 && bytes.length >= 32) {
      let encoder = new doc.defaultView.TextEncoder();
      let expected = new doc.defaultView.Uint8Array(
        await doc.defaultView.crypto.subtle.digest("SHA-256", encoder.encode(row.host))
      );
      for (let i = 0; i < 32; i++) {
        if (bytes[i] !== expected[i]) {
          let err = new Error("Cookie 域校验失败");
          err.code = "DECRYPT";
          throw err;
        }
      }
      bytes = bytes.slice(32);
    }
    return new doc.defaultView.TextDecoder("utf-8").decode(bytes);
  }

  function chromeExpiryToUnix(value) {
    let raw = Number(value || 0);
    if (!raw) {
      return 0;
    }
    return Math.floor(raw / 1000000 - 11644473600);
  }

  function cookieSameSite(value) {
    let n = Number(value);
    if (n === 2 && Ci.nsICookie.SAMESITE_STRICT !== undefined) {
      return Ci.nsICookie.SAMESITE_STRICT;
    }
    if (n === 1 && Ci.nsICookie.SAMESITE_LAX !== undefined) {
      return Ci.nsICookie.SAMESITE_LAX;
    }
    if (n === 0 && Ci.nsICookie.SAMESITE_NONE !== undefined) {
      return Ci.nsICookie.SAMESITE_NONE;
    }
    return Ci.nsICookie.SAMESITE_UNSET !== undefined
      ? Ci.nsICookie.SAMESITE_UNSET
      : Ci.nsICookie.SAMESITE_LAX;
  }

  function addCookieRecord(row, value, chromium) {
    let expiry = chromium ? chromeExpiryToUnix(row.expires) : Number(row.expires || row.expiry || 0);
    let isSession = row.session === true || !expiry;
    if (expiry && expiry <= Math.floor(Date.now() / 1000)) {
      return false;
    }
    let host = row.host || row.domain;
    if (!host) {
      throw new Error("Cookie 缺少域名");
    }
    let path = row.path || "/";
    let httpOnly = row.http_only !== undefined ? !!Number(row.http_only) : !!row.httpOnly;
    let secure = !!Number(row.secure);
    let schemeMap = secure
      ? Ci.nsICookie.SCHEME_HTTPS
      : (Ci.nsICookie.SCHEME_HTTP !== undefined
        ? Ci.nsICookie.SCHEME_HTTP
        : Ci.nsICookie.SCHEME_HTTPS);
    let validation = Services.cookies.add(
      host,
      path,
      row.name,
      String(value),
      secure,
      httpOnly,
      isSession,
      expiry,
      {},
      cookieSameSite(row.same_site),
      schemeMap,
      false
    );
    if (validation && validation.result !== undefined &&
        validation.result !== Ci.nsICookieValidation.eOK) {
      throw new Error("Gecko 拒绝写入 Cookie，代码 " + validation.result);
    }
    return true;
  }

  async function queryCookieDatabase(source, domain) {
    let condition = domain
      ? `(host_key = '${domain}' OR host_key = '.${domain}' OR host_key LIKE '%.${domain}')`
      : "1=1";
    let sql;
    if (source.type === "firefox") {
      condition = domain
        ? `(host = '${domain}' OR host = '.${domain}' OR host LIKE '%.${domain}')`
        : "1=1";
      sql = `SELECT host, name, value, path, CAST(expiry AS TEXT) AS expires, isSecure AS secure, isHttpOnly AS http_only, sameSite AS same_site FROM moz_cookies WHERE ${condition}`;
    } else {
      sql = `SELECT host_key AS host, name, value, hex(encrypted_value) AS encrypted_hex, path, CAST(expires_utc AS TEXT) AS expires, is_secure AS secure, is_httponly AS http_only, samesite AS same_site, (SELECT value FROM meta WHERE key='version') AS db_version FROM cookies WHERE ${condition}`;
    }
    let output = await Zotero.Utilities.Internal.subprocess("/usr/bin/sqlite3", [
      "-readonly",
      "-json",
      source.dbPath,
      sql
    ]);
    output = String(output || "").trim();
    return output ? JSON.parse(output) : [];
  }

  async function readSafariCookieSource(source, domain) {
    if (typeof zbParseSafariBinaryCookies !== "function") {
      throw new Error("Safari Cookie 解析模块未加载，请重启 Zotero 后重试");
    }
    let bytes;
    try {
      bytes = await IOUtils.read(source.path);
    } catch (e) {
      throw new Error("无法读取 Safari Cookies.binarycookies（可能被 macOS 隐私权限阻止）；请点击“选择 Safari 文件”并选择可读副本");
    }
    let parsed;
    try {
      parsed = zbParseSafariBinaryCookies(bytes, { now: Math.floor(Date.now() / 1000) });
    } catch (e) {
      throw new Error("Safari Cookies.binarycookies 格式无法解析：" + (e && e.message ? e.message : e));
    }
    let all = Array.isArray(parsed && parsed.cookies) ? parsed.cookies : [];
    let selected = domain
      ? all.filter(row => cookieDomainMatches(row.domain, domain))
      : all;
    let stats = parsed && parsed.stats ? parsed.stats : {};
    stats.selected = selected.length;
    stats.filtered = Math.max(0, all.length - selected.length);
    stats.fileExpired = Number(stats.expired || 0);
    stats.malformedRecords = Number(stats.malformed || 0);
    stats.parseErrors = Array.isArray(parsed && parsed.errors) ? parsed.errors.length : 0;
    stats.invalidFormat = Array.isArray(parsed && parsed.errors) && parsed.errors.some(message =>
      /invalid binarycookies|truncated binarycookies/i.test(String(message))
    );
    return { rows: selected, stats };
  }

  async function autoImportCookies() {
    let importAll = autoCookieScopeDropdown.getValue() === "all";
    let domain = importAll ? "" : normalizeCookieDomain(cookieDomainInput.value);
    if (!importAll && !domain) {
      showToast("当前主页没有可推断的域名，请先打开目标站点或手动填写域名；全部网站需在范围下拉中明确选择", "error");
      return;
    }
    let source = autoCookieSources[Number(autoCookieSourceDropdown.getValue())];
    if (!source) {
      showToast("请选择本机浏览器来源", "error");
      return;
    }
    if (importAll) {
      let confirmed = Services.prompt.confirm(
        doc.defaultView,
        "导入全部网站 Cookie",
        `将把 ${source.browserName}（${source.profileName}）中可解密的全部网站登录会话复制到 Zotero 内置浏览器。Cookie 只在本机读取和写入，不会上传到网络。是否继续？`
      );
      if (!confirmed) {
        return;
      }
    }
    autoCookieButton.disabled = true;
    autoCookieButton.textContent = "正在导入…";
    try {
      let safariStats = null;
      let rows;
      if (source.type === "safari") {
        let safariResult = await readSafariCookieSource(source, domain);
        rows = safariResult.rows;
        safariStats = safariResult.stats;
      } else {
        rows = await queryCookieDatabase(source, domain);
      }
      if (!rows.length) {
        let scopeMessage = importAll
          ? `未在 ${source.browserName} 中找到可导入的 Cookie`
          : `未在 ${source.browserName} 中找到 ${domain} 的 Cookie`;
        if (safariStats && safariStats.expired) {
          scopeMessage += `（该文件总计 ${safariStats.fileExpired || safariStats.expired} 条已过期，已跳过）`;
        }
        if (safariStats && safariStats.invalidFormat) {
          scopeMessage += "；所选文件不是有效的 Safari Cookies.binarycookies，请选择正确文件或使用文件副本";
        } else if (safariStats && safariStats.malformedRecords) {
          scopeMessage += `；文件有 ${safariStats.malformedRecords} 条损坏记录，已跳过`;
        } else if (safariStats && safariStats.parseErrors) {
          scopeMessage += `；文件有 ${safariStats.parseErrors} 个解析错误，已跳过`;
        }
        showToast(scopeMessage, "info");
        return;
      }
      let key = source.type === "chromium" ? await chromiumDecryptionKey(source) : null;
      let count = 0;
      let unsupported = 0;
      let decryptErrors = 0;
      let writeErrors = 0;
      for (let row of rows) {
        let value;
        try {
          value = source.type === "chromium"
            ? await decryptChromiumCookie(row, key)
            : String(row.value || "");
        } catch (e) {
          if (e && e.code === "V20") {
            unsupported++;
          } else {
            decryptErrors++;
            dump("[Zotero Browser] skipped one encrypted cookie: " + e + "\n");
          }
          continue;
        }
        try {
          if (addCookieRecord(row, value, source.type === "chromium")) {
            count++;
          }
        } catch (e) {
          writeErrors++;
          dump("[Zotero Browser] skipped one cookie write: " + e + "\n");
        }
      }
      if (!count && unsupported) {
        throw new Error("这些 Cookie 使用浏览器应用绑定加密，无法自动解密；请改用手动导入");
      }
      if (!count) {
        if (writeErrors) {
          throw new Error(`已解密 Cookie，但 Gecko 拒绝写入 ${writeErrors} 条；请查看 Zotero 调试日志`);
        }
        if (source.type === "chromium" && decryptErrors) {
          throw new Error(`读取到了 ${rows.length} 条 Cookie，但 ${decryptErrors} 条解密失败；请确认 macOS 钥匙串允许 Zotero 读取 ${source.browserName} Safe Storage`);
        }
        if (source.type === "safari" && safariStats) {
          let details = [];
          if (safariStats.fileExpired) details.push(`文件总计 ${safariStats.fileExpired} 条已过期`);
          if (safariStats.malformedRecords) details.push(`${safariStats.malformedRecords} 条格式损坏`);
          if (safariStats.invalidFormat) details.push("文件格式无效");
          throw new Error("Safari Cookie 没有可写入的有效记录" + (details.length ? "（" + details.join("、") + "）" : ""));
        }
        throw new Error("读取到了 Cookie，但全部已过期或无效");
      }
      cookieModal.style.display = "none";
      let skippedParts = [];
      if (unsupported) skippedParts.push(`${unsupported} 条应用绑定 Cookie 无法解密`);
      if (decryptErrors) skippedParts.push(`${decryptErrors} 条解密失败`);
      if (writeErrors) skippedParts.push(`${writeErrors} 条写入失败`);
      if (safariStats && safariStats.fileExpired) skippedParts.push(`文件总计 ${safariStats.fileExpired} 条已过期`);
      if (safariStats && safariStats.malformedRecords) skippedParts.push(`${safariStats.malformedRecords} 条格式损坏`);
      let skipped = skippedParts.length ? `（跳过 ${skippedParts.join("、")}）` : "";
      showToast(`已从 ${source.browserName} 导入 ${count} 条 Cookie${skipped}，正在刷新；完整登录态仍可能需要重新登录`, "success");
      setTimeout(() => reloadCurrent(), 400);
    } catch (err) {
      showToast("自动导入失败：" + (err && err.message ? err.message : err), "error");
    } finally {
      autoCookieButton.disabled = !autoCookieSources.length;
      autoCookieButton.textContent = "自动导入并刷新";
    }
  }

  function toggleCookieModal() {
    let isOpen = cookieModal.style.display === "flex";
    if (isOpen) {
      cookieModal.style.display = "none";
    } else {
      cookieModal.style.display = "flex";
      let currentUrl = getCleanCurrentUrl();
      try {
        let u = new URL(currentUrl);
        let host = u.hostname;
        cookieDomainInput.value = host.startsWith("www.") ? host.substring(3) : host;
      } catch (e) {
        cookieDomainInput.value = "";
      }
      detectLocalCookieSources();
    }
  }

  function applyImportedCookies() {
    let raw = cookieTextarea.value.trim();
    if (!raw) {
      showToast("请先粘贴 Cookie 内容", "error");
      return;
    }

    let defaultDomain = cookieDomainInput.value.trim();
    if (!defaultDomain) {
      try {
        let u = new URL(getCleanCurrentUrl());
        defaultDomain = u.hostname;
      } catch (e) {
        defaultDomain = "arxiv.org";
      }
    }
    if (!defaultDomain.startsWith(".")) {
      defaultDomain = "." + defaultDomain;
    }

    let count = 0;
    try {
      if (raw.startsWith("[") || raw.startsWith("{")) {
        let parsed = JSON.parse(raw);
        let list = Array.isArray(parsed) ? parsed : [parsed];
        for (let c of list) {
          let host = c.domain || defaultDomain;
          let path = c.path || "/";
          let name = c.name;
          let value = c.value;
          let isSecure = !!c.secure;
          let isHttpOnly = !!c.httpOnly;
          let expiry = c.expirationDate ? Math.floor(c.expirationDate) : Math.floor(Date.now() / 1000) + 31536000;
          if (name && value !== undefined) {
            Services.cookies.add(
              host,
              path,
              name,
              String(value),
              isSecure,
              isHttpOnly,
              false,
              expiry,
              {},
              Ci.nsICookie.SAMESITE_LAX,
              isSecure
                ? Ci.nsICookie.SCHEME_HTTPS
                : (Ci.nsICookie.SCHEME_HTTP !== undefined
                  ? Ci.nsICookie.SCHEME_HTTP
                  : Ci.nsICookie.SCHEME_HTTPS),
              false
            );
            count++;
          }
        }
      } else {
        let pairs = raw.split(";");
        for (let pair of pairs) {
          let idx = pair.indexOf("=");
          if (idx !== -1) {
            let name = pair.substring(0, idx).trim();
            let value = pair.substring(idx + 1).trim();
            if (name) {
              let expiry = Math.floor(Date.now() / 1000) + 31536000;
              Services.cookies.add(
                defaultDomain,
                "/",
                name,
                value,
                true,
                false,
                false,
                expiry,
                {},
                Ci.nsICookie.SAMESITE_LAX,
                Ci.nsICookie.SCHEME_HTTPS,
                false
              );
              count++;
            }
          }
        }
      }

      showToast(`✅ 成功导入 ${count} 条 Cookie，正在刷新...`, "success");
      cookieModal.style.display = "none";
      cookieTextarea.value = "";
      setTimeout(() => reloadCurrent(), 400);
    } catch (err) {
      showToast("❌ Cookie 解析导入失败: " + err.message, "error");
    }
  }

  function getPaneSelectionInfo() {
    let libraryID = Zotero.Libraries.userLibraryID;
    let selectedCol = null;
    try {
      let activePane = Zotero.getActiveZoteroPane ? Zotero.getActiveZoteroPane() : null;
      if (!activePane) {
        return { libraryID, selectedCol };
      }
      if (typeof activePane.getSelectedLibraryIDs === "function") {
        let ids = activePane.getSelectedLibraryIDs();
        if (ids && ids.length > 0) {
          libraryID = ids[0];
        }
      } else if (typeof activePane.getSelectedLibraryID === "function") {
        try {
          libraryID = activePane.getSelectedLibraryID() || libraryID;
        } catch (e) {}
      }
      if (typeof activePane.getSelectedCollections === "function") {
        let cols = activePane.getSelectedCollections();
        if (cols && cols.length > 0) {
          selectedCol = cols[0];
        }
      } else if (typeof activePane.getSelectedCollection === "function") {
        try {
          selectedCol = activePane.getSelectedCollection();
        } catch (e) {}
      }
    } catch (e) {
      dump("[Zotero Browser] Pane info error: " + e + "\n");
    }
    return { libraryID, selectedCol };
  }

  const PREF_LAST_COLLECTION = "extensions.zotero-browser.lastCollectionID";
  const PREF_LAST_LIBRARY = "extensions.zotero-browser.lastLibraryID";

  function el(tag, styles, props) {
    let node = doc.createElement(tag);
    if (styles) {
      node.style.cssText = styles;
    }
    if (props) {
      for (let key of Object.keys(props)) {
        if (key === "text") {
          node.textContent = props[key];
        } else if (key === "title") {
          node.title = props[key];
        } else {
          node[key] = props[key];
        }
      }
    }
    return node;
  }

  let saveModal = el("div", `
    position: absolute;
    top: 52px;
    left: 8px;
    right: 8px;
    max-height: 78vh;
    overflow: hidden;
    background: var(--material-sidepane, #ffffff);
    border: 1px solid var(--material-border, #d1d5db);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.22);
    padding: 12px;
    z-index: 10001;
    display: none;
    flex-direction: column;
    gap: 8px;
  `);
  let saveHeader = el("div", "display:flex;justify-content:space-between;align-items:center;padding-bottom:6px;border-bottom:1px solid var(--material-border,#e5e7eb);");
  saveHeader.appendChild(el("strong", "font-size:13px;", { text: "保存到哪个文件夹？" }));
  let saveCancelBtn = el("button", "height:24px;padding:0 8px;border:1px solid var(--material-border,#d1d5db);border-radius:4px;background:transparent;cursor:pointer;", { text: "取消" });
  saveHeader.appendChild(saveCancelBtn);
  let saveLibraryLabel = el("div", "font-size:11px;color:#4b5563;", { text: "文库" });
  let saveLibrarySelect = el("select", "width:100%;margin-top:4px;height:26px;border:1px solid var(--material-border,#d1d5db);border-radius:4px;");
  saveLibraryLabel.appendChild(saveLibrarySelect);
  let saveTree = el("div", "flex:1;min-height:160px;max-height:42vh;overflow:auto;border:1px solid var(--material-border,#e5e7eb);border-radius:6px;padding:4px;");
  let saveConfirmBtn = el("button", "height:28px;border:none;border-radius:6px;background:var(--accent-color,#2563eb);color:#fff;font-weight:600;cursor:pointer;", { text: "保存到此处" });
  saveConfirmBtn.classList.add("zb-btn-primary");
  saveModal.appendChild(saveHeader);
  saveModal.appendChild(saveLibraryLabel);
  saveModal.appendChild(saveTree);
  saveModal.appendChild(saveConfirmBtn);

  function getLibraryName(libraryID) {
    try {
      let lib = Zotero.Libraries.get(libraryID);
      if (lib) {
        return lib.name || (lib.libraryType === "group" ? "群组文库" : "我的文库");
      }
    } catch (e) {}
    return libraryID === Zotero.Libraries.userLibraryID ? "我的文库" : "文库";
  }

  function flattenCollections(libraryID) {
    let rows = [];
    function walk(cols, depth) {
      for (let col of cols || []) {
        rows.push({ id: col.id, name: col.name, depth, collection: col });
        let children = [];
        try {
          children = col.getChildCollections() || [];
        } catch (e) {}
        if (children.length) {
          walk(children, depth + 1);
        }
      }
    }
    let roots = [];
    try {
      roots = Zotero.Collections.getByLibrary(libraryID) || [];
    } catch (e) {}
    walk(roots, 0);
    return rows;
  }

  function chooseSaveLocation(defaultLibraryID, defaultCol) {
    return new Promise((resolve) => {
      if (!saveLibrarySelect || !saveTree) {
        resolve({
          cancelled: false,
          libraryID: defaultLibraryID || Zotero.Libraries.userLibraryID,
          collection: defaultCol || null
        });
        return;
      }
      let selected = {
        libraryID: defaultLibraryID || Zotero.Libraries.userLibraryID,
        collection: defaultCol || null
      };
      try {
        if (!selected.collection) {
          let lastCol = Zotero.Prefs.get(PREF_LAST_COLLECTION, true);
          if (lastCol && lastCol !== "0") {
            let col = Zotero.Collections.get(parseInt(lastCol, 10));
            if (col && col.libraryID === selected.libraryID) {
              selected.collection = col;
            }
          }
        }
      } catch (e) {}

      let libraries = [];
      try {
        libraries = Zotero.Libraries.getAll().filter(l => !l.libraryType || l.libraryType === "user" || l.libraryType === "group");
      } catch (e) {
        libraries = [{ libraryID: Zotero.Libraries.userLibraryID, name: "我的文库" }];
      }
      while (saveLibrarySelect.firstChild) {
        saveLibrarySelect.removeChild(saveLibrarySelect.firstChild);
      }
      libraries.forEach((lib) => {
        let id = lib.libraryID || lib.id;
        let opt = doc.createElement("option");
        opt.value = String(id);
        opt.textContent = lib.name || getLibraryName(id);
        if (id === selected.libraryID) {
          opt.selected = true;
        }
        saveLibrarySelect.appendChild(opt);
      });

      function paintTree() {
        while (saveTree.firstChild) {
          saveTree.removeChild(saveTree.firstChild);
        }
        let root = doc.createElement("div");
        let rootOn = !selected.collection;
        root.style.cssText = `padding:6px 8px;cursor:pointer;border-radius:4px;margin:2px;${rootOn ? "background:#dbeafe;" : ""}`;
        root.textContent = "📂 " + getLibraryName(selected.libraryID) + "（根目录）";
        root.addEventListener("click", () => {
          selected.collection = null;
          paintTree();
        });
        saveTree.appendChild(root);
        flattenCollections(selected.libraryID).forEach((row) => {
          let item = doc.createElement("div");
          let on = selected.collection && selected.collection.id === row.id;
          item.style.cssText = `padding:5px 8px;padding-left:${12 + row.depth * 14}px;cursor:pointer;border-radius:4px;margin:1px 2px;${on ? "background:#dbeafe;" : ""}`;
          item.textContent = "📁 " + row.name;
          item.title = row.name;
          item.addEventListener("click", () => {
            selected.collection = row.collection;
            paintTree();
          });
          saveTree.appendChild(item);
        });
      }

      saveLibrarySelect.onchange = () => {
        selected.libraryID = parseInt(saveLibrarySelect.value, 10);
        selected.collection = null;
        paintTree();
      };
      paintTree();
      try {
        cookieModal.style.display = "none";
      } catch (e) {}
      saveModal.style.display = "flex";

      let done = false;
      function finish(result) {
        if (done) {
          return;
        }
        done = true;
        saveModal.style.display = "none";
        resolve(result);
      }
      saveCancelBtn.onclick = () => finish({ cancelled: true });
      saveConfirmBtn.onclick = () => {
        try {
          Zotero.Prefs.set(PREF_LAST_LIBRARY, String(selected.libraryID), true);
          Zotero.Prefs.set(PREF_LAST_COLLECTION, selected.collection ? String(selected.collection.id) : "0", true);
        } catch (e) {}
        finish({ cancelled: false, libraryID: selected.libraryID, collection: selected.collection });
      };
    });
  }

  async function saveCurrentPageToZotero(openInReaderAfterSave = false) {
    // Bind the title and URL before opening an asynchronous destination picker.
    const currentTargetUrl = getCleanCurrentUrl();
    const currentTargetTitle = browser.contentTitle || currentTargetUrl;
    if (!currentTargetUrl || currentTargetUrl === "about:blank") {
      showToast("请先打开有效网页或文献再保存", "error");
      return;
    }

    try {
      let pane = getPaneSelectionInfo();
      let choice;
      try {
        choice = await chooseSaveLocation(pane.libraryID, pane.selectedCol);
      } catch (e) {
        dump("[Zotero Browser] chooseSaveLocation: " + e + "\n");
        choice = { cancelled: false, libraryID: pane.libraryID, collection: pane.selectedCol };
      }
      if (!choice || choice.cancelled) {
        return;
      }
      let libraryID = choice.libraryID;
      let selectedCol = choice.collection;

      showToast("⏳ 正在获取文献元数据并保存...", "info");

      // 识别 arXiv 官方站与镜像站（如 arxiv.q-cs.cn）的 abs/pdf/html 页面
      let arxivMatch = currentTargetUrl.match(/^https?:\/\/((?:[a-z0-9-]+\.)*arxiv[a-z0-9.-]*?)\/(abs|pdf|html|src)\/([0-9]+\.[0-9]+(v[0-9]+)?|[a-z\-]+(\.[A-Z]{2})?\/\d{7})/i);
      if (arxivMatch && arxivMatch[3]) {
        let arxivHost = (arxivMatch[1] || "arxiv.org").toLowerCase();
        let isOfficialHost = /(^|\.)arxiv\.org$/.test(arxivHost);
        let rawArxivId = arxivMatch[3];
        let arxivId = rawArxivId.replace(/\.pdf$/i, "");
        let cleanIdWithoutVersion = arxivId.replace(/v[0-9]+$/i, "");

        // 元数据来源一：arXiv 官方 API（export.arxiv.org，信息最全）
        async function fetchArxivMetaViaApi(cleanId) {
          let apiUrl = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(cleanId)}`;
          let resp = await Zotero.HTTP.request("GET", apiUrl, { timeout: 12000 });
          let xmlText = resp.responseText;
          let xmlDoc = new DOMParser().parseFromString(xmlText, "text/xml");
          let entry = xmlDoc.querySelector("entry");
          if (!entry) {
            throw new Error("API 未返回该文献");
          }
          // doi/journal_ref/comment 等元素带 arxiv: 命名空间，按 localName 遍历
          let nsField = (name) => {
            for (let node of entry.children) {
              if (node.localName === name) {
                return (node.textContent || "").trim();
              }
            }
            return "";
          };
          let primaryCat = "";
          try {
            let pc = entry.getElementsByTagName("arxiv:primary_category")[0] ||
              entry.getElementsByTagName("primary_category")[0];
            primaryCat = pc ? (pc.getAttribute("term") || "") : "";
          } catch (e) {}
          let authorNames = [];
          entry.querySelectorAll("author name").forEach(n => {
            let full = (n.textContent || "").trim();
            if (full) {
              authorNames.push(full);
            }
          });
          return {
            title: (entry.querySelector("title")?.textContent || "").replace(/\s+/g, " ").trim(),
            summary: (entry.querySelector("summary")?.textContent || "").replace(/\s+/g, " ").trim(),
            date: (entry.querySelector("published")?.textContent || "").substring(0, 10) ||
              (entry.querySelector("updated")?.textContent || "").substring(0, 10),
            doi: nsField("doi"),
            journalRef: nsField("journal_ref"),
            comment: nsField("comment"),
            primaryCat,
            authorNames,
            pdfUrl: ""
          };
        }

        // 元数据来源二：abs 页面的 citation_* 元标签（API 挂掉时的兜底，
        // 与正常浏览 arxiv 走同一网络路径，能浏览就能取到）
        async function fetchArxivMetaViaAbsPage(id, host) {
          let resp = await Zotero.HTTP.request(
            "GET", "https://" + host + "/abs/" + encodeURIComponent(id), { timeout: 12000 }
          );
          let docp = new DOMParser().parseFromString(resp.responseText, "text/html");
          let metaAll = (name) => Array.from(docp.querySelectorAll(`meta[name="${name}"]`))
            .map(el => (el.getAttribute("content") || "").trim()).filter(Boolean);
          let title = metaAll("citation_title")[0] || "";
          if (!title) {
            throw new Error("abs 页面未返回标题");
          }
          let desc = docp.querySelector('meta[name="description"]');
          return {
            title,
            summary: desc ? (desc.getAttribute("content") || "").trim() : "",
            date: (metaAll("citation_date")[0] || metaAll("citation_online_date")[0] || "").replace(/\//g, "-"),
            doi: metaAll("citation_doi")[0] || "",
            journalRef: "",
            comment: "",
            primaryCat: "",
            authorNames: metaAll("citation_author"),
            pdfUrl: metaAll("citation_pdf_url")[0] || ""
          };
        }

        // 多个来源并行请求，第一个成功的直接采用：官方 API 被限流/超时
        // 时不再傻等 20s 串行重试，镜像站也能作为兜底来源。
        function firstSuccess(fetchers) {
          return new Promise((resolve, reject) => {
            let pending = fetchers.length;
            let lastErr = null;
            if (!pending) {
              reject(new Error("无可用元数据来源"));
              return;
            }
            fetchers.forEach(fn => {
              Promise.resolve().then(fn).then(
                (value) => {
                  if (value && value.title) {
                    resolve(value);
                  } else if (--pending === 0) {
                    reject(lastErr || new Error("元数据为空"));
                  }
                },
                (err) => {
                  lastErr = err;
                  if (--pending === 0) {
                    reject(err);
                  }
                }
              );
            });
          });
        }

        let fetchers = [
          () => fetchArxivMetaViaApi(cleanIdWithoutVersion),
          () => fetchArxivMetaViaAbsPage(arxivId, "arxiv.org")
        ];
        if (!isOfficialHost) {
          fetchers.push(() => fetchArxivMetaViaAbsPage(arxivId, arxivHost));
        }

        let meta = null;
        let apiErr = null;
        try {
          meta = await firstSuccess(fetchers);
        } catch (err) {
          apiErr = err;
          dump("[Zotero Browser] arXiv metadata error: " + err + "\n");
        }
        if (!meta || !meta.title) {
          showToast("❌ 获取 arXiv 元数据失败（" + (apiErr && apiErr.message ? apiErr.message : "网络错误") + "），未保存", "error");
          return;
        }

        let title = meta.title;
        // 作者解析交给 Zotero 的 cleanAuthor（自动兼容 "First Last" 与
        // "Last, First" 两种格式）
        let authors = [];
        for (let full of meta.authorNames) {
          try {
            authors.push(Zotero.Utilities.cleanAuthor(full, "author", full.includes(",")));
          } catch (e) {
            let parts = full.split(/\s+/);
            authors.push({ firstName: parts.slice(0, -1).join(" "), lastName: parts.pop() || full, creatorType: "author" });
          }
        }

        let item = new Zotero.Item("preprint");
        item.libraryID = libraryID;
        item.setField("title", title);
        item.setField("abstractNote", meta.summary || "");
        item.setField("date", meta.date || "");
        item.setField("url", `https://arxiv.org/abs/${arxivId}`);
        item.setField("archiveID", `arXiv:${arxivId}`);
        item.setField("repository", "arXiv");
        item.setField("libraryCatalog", "arXiv.org");
        if (meta.doi) {
          item.setField("DOI", meta.doi);
        }
        if (meta.primaryCat) {
          item.setField("extra", `arXiv: ${arxivId} [${meta.primaryCat}]`);
        }
        if (authors.length > 0) {
          item.setCreators(authors);
        }
        if (selectedCol) {
          item.addToCollection(selectedCol.id);
        }

        let itemID = await item.saveTx();

        // 立即反馈保存成功（附件下载可能耗时几十秒，不能等它完成才提示）
        showToast(`✅ 已保存到「${selectedCol ? selectedCol.name : getLibraryName(libraryID)}」：「${title.substring(0, 18)}${title.length > 18 ? "…" : ""}」`, "success");

        // 期刊发表信息与 arXiv 评论（如 "15 pages, 9 figures"）存为子笔记
        let noteLines = [];
        if (meta.journalRef) {
          noteLines.push("Journal reference: " + meta.journalRef);
        }
        if (meta.comment) {
          noteLines.push("Comment: " + meta.comment);
        }
        if (noteLines.length) {
          try {
            let note = new Zotero.Item("note");
            note.libraryID = libraryID;
            note.parentID = itemID;
            note.setNote(noteLines.map(l => "<p>" + Zotero.Utilities.htmlSpecialChars(l) + "</p>").join(""));
            await note.saveTx();
          } catch (e) {
            dump("[Zotero Browser] note save note: " + e + "\n");
          }
        }

        let attachmentItem = null;
        let pdfCandidates = [];
        if (!isOfficialHost) {
          // 正在通过镜像站浏览：镜像的 PDF 下载通常更快更稳
          pdfCandidates.push(`https://${arxivHost}/pdf/${arxivId}`);
        }
        if (meta.pdfUrl) {
          pdfCandidates.push(meta.pdfUrl);
        }
        pdfCandidates.push(`https://arxiv.org/pdf/${arxivId}.pdf`);
        pdfCandidates.push(`https://arxiv.org/pdf/${arxivId}`);
        pdfCandidates = [...new Set(pdfCandidates)];
        let attachErr = null;
        for (let pdfUrl of pdfCandidates) {
          try {
            attachmentItem = await Zotero.Attachments.importFromURL({
              url: pdfUrl,
              parentItemID: itemID,
              title: "Full Text PDF",
              contentType: "application/pdf"
            });
            attachErr = null;
            break;
          } catch (e) {
            attachErr = e;
            dump("[Zotero Browser] PDF import failed for " + pdfUrl + ": " + e + "\n");
          }
        }
        if (attachmentItem) {
          showToast("✅ PDF 附件下载完成", "success");
        } else {
          dump("[Zotero Browser] PDF attachment import note: " + attachErr + "\n");
          showToast("⚠️ 条目已保存，但 PDF 附件下载失败", "error");
        }

        if (openInReaderAfterSave && attachmentItem) {
          try {
            if (Zotero.Reader && Zotero.Reader.open) {
              await Zotero.Reader.open(attachmentItem.id);
            }
          } catch (e) {
            dump("[Zotero Browser] Reader open note: " + e + "\n");
          }
        }
        return;
      }

      let title = currentTargetTitle;
      let isPdf = zbIsPdfUrl(currentTargetUrl);
      let item = new Zotero.Item(isPdf ? "journalArticle" : "webpage");
      item.libraryID = libraryID;
      item.setField("title", title);
      item.setField("url", currentTargetUrl);
      item.setField("accessDate", new Date().toISOString().replace("T", " ").substring(0, 19));
      if (selectedCol) {
        item.addToCollection(selectedCol.id);
      }
      let itemID = await item.saveTx();

      // 立即反馈保存成功（附件下载可能耗时，不能等它完成才提示）
      showToast(`✅ 已保存到「${selectedCol ? selectedCol.name : getLibraryName(libraryID)}」：「${title.substring(0, 18)}${title.length > 18 ? "…" : ""}」`, "success");

      let attachmentItem = null;
      if (isPdf) {
        try {
          attachmentItem = await Zotero.Attachments.importFromURL({
            url: currentTargetUrl,
            parentItemID: itemID,
            title: "Full Text PDF",
            contentType: "application/pdf"
          });
          showToast("✅ PDF 附件下载完成", "success");
        } catch (e) {
          showToast("⚠️ 条目已保存，但 PDF 附件下载失败", "error");
        }
      }

      if (openInReaderAfterSave && attachmentItem) {
        try {
          if (Zotero.Reader && Zotero.Reader.open) {
            await Zotero.Reader.open(attachmentItem.id);
          }
        } catch (e) {}
      }
    } catch (err) {
      dump("[Zotero Browser] Save error: " + err + "\n");
      showToast("❌ 保存失败: " + err.message, "error");
    }
  }

  let toastBox = doc.createElement("div");
  toastBox.style.cssText = `
    position: absolute;
    bottom: 12px;
    right: 12px;
    padding: 6px 12px;
    border-radius: 4px;
    background: #1e1e24;
    color: #ffffff;
    font-size: 11px;
    font-weight: 500;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    z-index: 99999;
  `;
  let toastTimer = null;
  function showToast(msg, type) {
    toastBox.textContent = msg;
    toastBox.style.backgroundColor = type === "error" ? "#ef4444" : type === "success" ? "#10b981" : "#1e1e24";
    toastBox.style.opacity = "1";
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toastBox.style.opacity = "0";
    }, 3500);
  }

  // ---- 人机验证提示条：页面被 Cloudflare 等验证卡住时给出可操作的出口 ----
  let captchaBar = null;
  function ensureCaptchaBar() {
    if (captchaBar) {
      return captchaBar;
    }
    captchaBar = doc.createElement("div");
    captchaBar.style.cssText = `
      display: none; align-items: center; flex-wrap: wrap; gap: 6px;
      flex: 0 0 auto; padding: 6px 8px; box-sizing: border-box;
      background: var(--material-background, #fff7ed);
      border-bottom: 1px solid #fdba74; color: var(--fill-primary, #9a3412);
      font-size: 11px; line-height: 1.4;
    `;
    // Keep advice outside the webpage: never cover the challenge widget.
    wrapper.insertBefore(captchaBar, viewport);
    return captchaBar;
  }

  function hideCaptchaBar() {
    if (captchaBar) {
      captchaBar.style.display = "none";
    }
  }

  function showCaptchaBar(b, url, hasWidget, blocked, loop, stuck) {
    ensureCaptchaBar();
    captchaBar._browser = b;
    captchaBar.replaceChildren();
    let text = doc.createElement("span");
    text.style.cssText = "flex:1 1 220px;min-width:0;";
    text.textContent = blocked
      ? "站点拒绝了本次访问。可更新 Zotero 后重试，或在系统浏览器检查该站点。"
      : "请在网页中完成验证。若反复失败，请检查网络并更新 Zotero；内嵌浏览器可能不被站点完整支持。";
    captchaBar.appendChild(text);
    let button = (label, action) => {
      let el = doc.createElement("button");
      el.textContent = label;
      el.style.cssText = "font-size:11px;white-space:nowrap;cursor:pointer;";
      el.addEventListener("click", action);
      captchaBar.appendChild(el);
    };
    button("重新加载", () => { try { b.reload(); } catch (e) {} });
    button("系统浏览器打开", () => { try { Zotero.launchURL(url); } catch (e) {} });
    button("关闭提示", () => {
      let tab = tabs.find(t => t.browser === b);
      if (tab) tab.captchaDismissedUrl = url;
      hideCaptchaBar();
    });
    captchaBar.style.display = "flex";
  }

  function updateToolbarsVisibility() {
    if (toolbarsVisible) {
      toolbar.style.display = "flex";
      actionBar.style.display = "flex";
      bookmarksBar.style.display = "flex";
      btnToggleToolbars.innerHTML = svgIcon(ICONS.chevronUp, 13);
    } else {
      toolbar.style.display = "none";
      actionBar.style.display = "none";
      bookmarksBar.style.display = "none";
      btnToggleToolbars.innerHTML = svgIcon(ICONS.chevronDown, 13);
    }
    updateToolbarToggleTooltip();
  }

  function toggleToolbars() {
    toolbarsVisible = !toolbarsVisible;
    saveToolbarsVisibility(toolbarsVisible);
    updateToolbarsVisibility();
  }

  /* ---------- 可自定义快捷键 ---------- */
  const PREF_SHORTCUTS = "extensions.zotero-browser.shortcuts";
  const SHORTCUT_DEFAULTS = {
    toggleBrowserPanel: "Mod+Shift+B",
    toggleToolbars: "Mod+Shift+U",
    focusUrl: "Mod+L",
    newTab: "Mod+T",
    closeTab: "Mod+W",
    reload: "Mod+R",
    saveToZotero: "Mod+S"
  };
  const SHORTCUT_LABELS = {
    toggleBrowserPanel: "折叠 / 展开右侧浏览器",
    toggleToolbars: "收起 / 展开工具栏（^ 按钮）",
    focusUrl: "聚焦地址栏",
    newTab: "新建标签页",
    closeTab: "关闭当前标签页",
    reload: "刷新当前页",
    saveToZotero: "保存当前页到 Zotero"
  };

  function loadShortcuts() {
    let map = Object.assign({}, SHORTCUT_DEFAULTS);
    try {
      let raw = Zotero.Prefs.get(PREF_SHORTCUTS, true);
      if (raw) {
        let saved = JSON.parse(raw);
        // Keep the user's existing global-window shortcut for the right panel.
        if (typeof saved.toggleBrowserPanel !== "string" && typeof saved.toggleGlobalWindow === "string") {
          saved.toggleBrowserPanel = saved.toggleGlobalWindow;
        }
        for (let id of Object.keys(SHORTCUT_DEFAULTS)) {
          if (typeof saved[id] === "string") {
            map[id] = saved[id];
          }
        }
      }
    } catch (e) {}
    return map;
  }

  function saveShortcuts(map) {
    try {
      Zotero.Prefs.set(PREF_SHORTCUTS, JSON.stringify(map), true);
    } catch (e) {}
    // 让主窗口菜单/工具栏按钮上的快捷键提示立即刷新
    try {
      let mw = Zotero.getMainWindow();
      let label = comboLabel(map.toggleBrowserPanel || "");
      let mi = mw && mw.document && mw.document.getElementById("zotero-browser-menu-item");
      if (mi) {
        mi.setAttribute("acceltext", label);
      }
      let tb = mw && mw.document && mw.document.getElementById("zotero-browser-toolbar-btn");
      if (tb) {
        tb.setAttribute("tooltiptext", "折叠/展开右侧浏览器（" + label + "，可在浏览器 ⚙ 设置中修改）");
      }
    } catch (e) {}
  }

  // 把键盘事件规范成组合键字符串；Mod 代表 Ctrl 或 Cmd（两者等价）。
  function comboFromEvent(e) {
    let key = e.key;
    if (!key || key === "Control" || key === "Meta" || key === "Alt" || key === "Shift") {
      return null;
    }
    let parts = [];
    if (e.ctrlKey || e.metaKey) {
      parts.push("Mod");
    }
    if (e.altKey) {
      parts.push("Alt");
    }
    if (e.shiftKey) {
      parts.push("Shift");
    }
    if (key === " ") {
      key = "Space";
    }
    if (key.length === 1) {
      key = key.toUpperCase();
    }
    parts.push(key);
    return parts.join("+");
  }

  function comboLabel(combo) {
    if (!combo) {
      return "未设置";
    }
    return combo.replace(/^Mod/, "⌘/Ctrl");
  }

  let shortcutMap = loadShortcuts();
  let recordingShortcut = null; // 设置面板正在录制快捷键的动作 id

  function runShortcutAction(id) {
    if (id === "toggleToolbars") {
      toggleToolbars();
    } else if (id === "focusUrl") {
      if (!toolbarsVisible) {
        toolbarsVisible = true;
        saveToolbarsVisibility(true);
        updateToolbarsVisibility();
      }
      urlInput.focus();
      urlInput.select();
    } else if (id === "newTab") {
      addTab("about:blank", { showHome: true });
    } else if (id === "closeTab") {
      closeTab(activeTabId);
    } else if (id === "reload") {
      reloadCurrent();
    } else if (id === "saveToZotero") {
      saveCurrentPageToZotero(false);
    }
  }

  function updateToolbarToggleTooltip() {
    try {
      btnToggleToolbars.title = (toolbarsVisible ? "收起工具栏" : "展开工具栏") +
        "（快捷键 " + comboLabel(shortcutMap.toggleToolbars) + "，可在 ⚙ 设置中修改）";
    } catch (e) {}
  }
  updateToolbarToggleTooltip();

  /* ---------- 设置面板（自定义快捷键） ---------- */
  let settingsPanel = null;

  function renderSettingsRows() {
    if (!settingsPanel) {
      return;
    }
    let list = settingsPanel.querySelector("#zb-settings-list");
    if (!list) {
      return;
    }
    list.innerHTML = "";
    for (let id of Object.keys(SHORTCUT_LABELS)) {
      let row = doc.createElement("div");
      row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:3px 2px;";
      let label = doc.createElement("span");
      label.textContent = SHORTCUT_LABELS[id];
      label.style.cssText = "font-size:12px;color:var(--fill-primary, #212529);";
      let btn = doc.createElement("button");
      btn.textContent = recordingShortcut === id ? "按下新快捷键…(Esc 取消)" : comboLabel(shortcutMap[id]);
      btn.style.cssText = `
        min-width: 96px;
        padding: 2px 8px;
        font-size: 11px;
        border-radius: 6px;
        cursor: pointer;
        border: 1px solid ${recordingShortcut === id ? "var(--accent-color, #d97757)" : "var(--material-border, #d1d5db)"};
        background: var(--zb-btn-bg, #ffffff);
        color: var(--fill-primary, #212529);
        font-family: monospace;
      `;
      btn.addEventListener("click", () => {
        if (recordingShortcut) {
          return;
        }
        recordingShortcut = id;
        try {
          doc.defaultView.__zbRecordingShortcut = true;
        } catch (e) {}
        renderSettingsRows();
        let onKey = (e) => {
          e.preventDefault();
          e.stopPropagation();
          // 只按下修饰键（Cmd/Ctrl/Alt/Shift）时是组合键的前半段，
          // 继续等待，不要结束录制。
          if (e.key === "Control" || e.key === "Meta" || e.key === "Alt" || e.key === "Shift") {
            return;
          }
          doc.removeEventListener("keydown", onKey, true);
          try {
            doc.defaultView.__zbRecordingShortcut = false;
          } catch (err) {}
          let done = recordingShortcut;
          recordingShortcut = null;
          if (e.key !== "Escape") {
            let combo = comboFromEvent(e);
            if (combo) {
              // 冲突处理：占用同一组合键的其它动作先让位。
              for (let other of Object.keys(shortcutMap)) {
                if (other !== done && shortcutMap[other] === combo) {
                  shortcutMap[other] = "";
                }
              }
              shortcutMap[done] = combo;
              saveShortcuts(shortcutMap);
              updateToolbarToggleTooltip();
              showToast("快捷键已更新：" + SHORTCUT_LABELS[done] + " → " + comboLabel(combo), "success");
            }
          }
          renderSettingsRows();
        };
        doc.addEventListener("keydown", onKey, true);
      });
      row.appendChild(label);
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  function toggleSettingsPanel() {
    if (settingsPanel && settingsPanel.style.display === "flex") {
      settingsPanel.style.display = "none";
      return;
    }
    if (!settingsPanel) {
      settingsPanel = doc.createElement("div");
      settingsPanel.style.cssText = `
        position: absolute;
        top: 32px;
        right: 34px;
        z-index: 10002;
        display: none;
        flex-direction: column;
        gap: 4px;
        padding: 10px;
        min-width: 260px;
        background: var(--material-sidepane, #ffffff);
        border: 1px solid var(--material-border, #d1d5db);
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
      `;
      let caption = doc.createElement("div");
      caption.textContent = "自定义快捷键（点击右侧按键后按下新组合）";
      caption.style.cssText = "font-size:11px;font-weight:600;color:var(--fill-secondary, #7a7263);padding:0 2px 4px;";
      settingsPanel.appendChild(caption);
      // 划词翻译开关（默认关闭，带记忆）
      let transRow = doc.createElement("label");
      transRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 2px 6px;font-size:12px;color:var(--fill-primary, #212529);cursor:pointer;border-bottom:1px dashed var(--material-border, #d1d5db);margin-bottom:4px;";
      let transCheckbox = doc.createElement("input");
      transCheckbox.type = "checkbox";
      transCheckbox.checked = isWordTranslationEnabled();
      transCheckbox.style.cursor = "pointer";
      transCheckbox.addEventListener("change", () => {
        try {
          Zotero.Prefs.set(PREF_WORD_TRANSLATION, !!transCheckbox.checked, true);
        } catch (e) {}
        showToast(transCheckbox.checked ? "划词翻译已开启" : "划词翻译已关闭", "success");
      });
      transRow.appendChild(transCheckbox);
      transRow.appendChild(doc.createTextNode("划词翻译（选中英文自动弹出译文）"));
      settingsPanel.appendChild(transRow);
      let list = doc.createElement("div");
      list.id = "zb-settings-list";
      settingsPanel.appendChild(list);
      let resetBtn = doc.createElement("button");
      resetBtn.textContent = "恢复默认快捷键";
      resetBtn.style.cssText = "margin-top:4px;padding:3px 10px;font-size:11px;border-radius:6px;cursor:pointer;border:1px solid var(--material-border, #d1d5db);background:var(--zb-btn-bg, #ffffff);color:var(--fill-primary, #212529);";
      resetBtn.addEventListener("click", () => {
        shortcutMap = Object.assign({}, SHORTCUT_DEFAULTS);
        saveShortcuts(shortcutMap);
        updateToolbarToggleTooltip();
        renderSettingsRows();
        showToast("已恢复默认快捷键", "success");
      });
      settingsPanel.appendChild(resetBtn);
      wrapper.appendChild(settingsPanel);
    }
    renderSettingsRows();
    settingsPanel.style.display = "flex";
  }

  // 点击设置面板外部时收起（与皮肤菜单一致）。
  let settingsOutsideClick = (e) => {
    if (settingsPanel && settingsPanel.style.display === "flex" &&
        !settingsPanel.contains(e.target) && e.target !== btnSettings &&
        !btnSettings.contains(e.target)) {
      settingsPanel.style.display = "none";
    }
  };
  doc.addEventListener("click", settingsOutsideClick, true);
  registerDispose(() => doc.removeEventListener("click", settingsOutsideClick, true));

  let wrapperKeydownHandler = (e) => {
    if (recordingShortcut) {
      return; // 设置面板正在录制，交给录制监听器处理
    }
    const zoomCommand = zbZoom.command(e);
    if (zoomCommand) {
      e.preventDefault(); e.stopImmediatePropagation();
      zoomCurrentPage(zoomCommand); return;
    }
    // Ctrl/⌘+Tab 切换标签页（固定，不开放自定义）
    if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
      e.preventDefault();
      if (!tabs.length) {
        return;
      }
      let idx = tabs.findIndex(t => t.id === activeTabId);
      if (e.shiftKey) {
        idx = (idx - 1 + tabs.length) % tabs.length;
      } else {
        idx = (idx + 1) % tabs.length;
      }
      activateTab(tabs[idx].id);
      return;
    }
    if (e.key === "Escape" && themeMenu?.style.display === "flex") {
      e.preventDefault(); themeMenu.style.display = "none"; return;
    }
    if (e.key === "Escape" && isPdfOpen()) {
      closePdfViewer(true);
      return;
    }
    if (e.key === "F5") {
      e.preventDefault();
      reloadCurrent();
      return;
    }
    let combo = comboFromEvent(e);
    if (!combo) {
      return;
    }
    for (let id of Object.keys(shortcutMap)) {
      // 面板开关由 bootstrap 窗口监听器处理，避免一次按键触发两次。
      if (id === "toggleBrowserPanel") {
        continue;
      }
      if (shortcutMap[id] && shortcutMap[id] === combo) {
        e.preventDefault();
        runShortcutAction(id);
        return;
      }
    }
  };
  wrapper.addEventListener("keydown", wrapperKeydownHandler, true);
  registerDispose(() => wrapper.removeEventListener("keydown", wrapperKeydownHandler, true));

  viewport.appendChild(browser);
  // The initial browser is configured before it is inserted into the document.
  // Retry the compatibility frame bridge now that its message manager exists.
  attachLegacyFrameBridge(browser);
  viewport.appendChild(pdfFrame);
  setupPdfMessageBridge();
  viewport.appendChild(pdfFallback);
  viewport.appendChild(welcomeView);

  let resizeBar = doc.createElement("div");
  resizeBar.className = "zb-resize-handle";
  resizeBar.title = "按住上下拖拽可自由调整高度；双击恢复默认高度 (1025px)";
  resizeBar.style.cssText = `
    order: -1;
    height: 8px;
    width: 100%;
    background: var(--material-background, #e5e7eb);
    border-bottom: 1px solid var(--material-border, #d1d5db);
    cursor: ns-resize;
    flex-shrink: 0;
    display: ${scope === "sidebar" ? "flex" : "none"};
    align-items: center;
    justify-content: center;
    user-select: none;
    -moz-user-select: none;
    transition: background 0.15s ease;
    z-index: 10;
  `;
  let resizeGrip = doc.createElement("div");
  resizeGrip.style.cssText = `
    width: 36px;
    height: 3px;
    border-radius: 2px;
    background: var(--material-border, #9ca3af);
    pointer-events: none;
    transition: background 0.15s ease;
  `;
  resizeBar.appendChild(resizeGrip);

  let isDragging = false;
  let dragStartY = 0;
  let dragStartHeight = 0;
  let activeResizeCleanup = null;

  function onResizeMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    dragStartY = e.clientY;
    dragStartHeight = wrapper.offsetHeight || currentSidebarHeight;
    resizeBar.style.background = "var(--accent-color, #2563eb)";
    resizeGrip.style.background = "#ffffff";
    if (doc.body) {
      doc.body.style.cursor = "ns-resize";
      doc.body.style.userSelect = "none";
    }

    let win = doc.defaultView || window;
    function onMouseMove(moveEvent) {
      if (!isDragging) return;
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      // The handle sits at the top of the panel: dragging it up grows the
      // section, dragging down shrinks it.
      let deltaY = moveEvent.clientY - dragStartY;
      let newHeight = dragStartHeight - deltaY;
      applyHeight(newHeight);
    }

    function onMouseUp(upEvent) {
      if (!isDragging) return;
      isDragging = false;
      win.removeEventListener("mousemove", onMouseMove, true);
      win.removeEventListener("mouseup", onMouseUp, true);
      activeResizeCleanup = null;
      resizeBar.style.background = "var(--material-background, #e5e7eb)";
      resizeGrip.style.background = "var(--material-border, #9ca3af)";
      if (doc.body) {
        doc.body.style.cursor = "";
        doc.body.style.userSelect = "";
      }
      let finalDeltaY = upEvent.clientY - dragStartY;
      let finalHeight = dragStartHeight - finalDeltaY;
      applyHeight(finalHeight);
      saveSidebarHeight(currentSidebarHeight);
      showToast(`已保存高度: ${currentSidebarHeight}px`, "info");
    }

    win.addEventListener("mousemove", onMouseMove, true);
    win.addEventListener("mouseup", onMouseUp, true);
    activeResizeCleanup = () => {
      win.removeEventListener("mousemove", onMouseMove, true);
      win.removeEventListener("mouseup", onMouseUp, true);
      isDragging = false;
    };
  }

  resizeBar.addEventListener("mousedown", onResizeMouseDown);
  resizeBar.addEventListener("mouseenter", () => {
    if (!isDragging) {
      resizeBar.style.background = "var(--material-border, #cbd5e1)";
      resizeGrip.style.background = "#4b5563";
    }
  });
  resizeBar.addEventListener("mouseleave", () => {
    if (!isDragging) {
      resizeBar.style.background = "var(--material-background, #e5e7eb)";
      resizeGrip.style.background = "var(--material-border, #9ca3af)";
    }
  });
  resizeBar.addEventListener("dblclick", (e) => {
    e.preventDefault();
    applyHeight(DEFAULT_SIDEBAR_HEIGHT);
    saveSidebarHeight(DEFAULT_SIDEBAR_HEIGHT);
    showToast(`已恢复默认高度: ${DEFAULT_SIDEBAR_HEIGHT}px`, "success");
  });

  wrapper.appendChild(tabBar);
  wrapper.appendChild(toolbar);
  wrapper.appendChild(actionBar);
  wrapper.appendChild(bookmarksBar);
  wrapper.appendChild(progressTrack);
  wrapper.appendChild(viewport);
  wrapper.appendChild(resizeBar);
  wrapper.appendChild(cookieModal);
  wrapper.appendChild(saveModal);
  wrapper.appendChild(toastBox);

  attachTo(body);

  try {
    browser.setAttribute("messagemanagergroup", "zotero-browser");
  } catch (e) {}
  try {
    if (typeof registerEmbedActor === "function") {
      registerEmbedActor();
    }
  } catch (e) {
    dump("[Zotero Browser] registerEmbedActor after UI: " + e + "\n");
  }

  let ownerWin = doc.defaultView;
  function onPopupBlocked(event) {
    try {
      let uri = event.popupWindowURI;
      let spec = uri && (uri.spec || uri.asciiSpec || String(uri));
      if (spec && /^https?:/i.test(spec)) {
        addTab(spec);
      }
    } catch (e) {}
  }
  if (ownerWin && !wrapper._zbPopupHandler) {
    wrapper._zbPopupHandler = onPopupBlocked;
    ownerWin.addEventListener("DOMPopupBlocked", onPopupBlocked, true);
  }
  tabs.forEach((t) => {
    try {
      t.browser.addEventListener("DOMPopupBlocked", onPopupBlocked, true);
    } catch (e) {}
  });
  if (ownerWin && !wrapper._zbPdfMessageHandler) {
    wrapper._zbPdfMessageHandler = (event) => {
      let data = event.data;
      if (!data || typeof data.type !== "string" || data.type.indexOf("zb-pdf-") !== 0) {
        return;
      }
      handlePdfBridgeEvent(data);
    };
    ownerWin.addEventListener("message", wrapper._zbPdfMessageHandler);
  }
  // window.postMessage from the content <browser> is unreliable in Zotero, so
  // the frame script re-broadcasts viewer events over the message manager.
  if (!wrapper._zbPdfMmBridgeAttached) {
    try {
      let mm = pdfFrame.messageManager;
      if (mm && mm.loadFrameScript) {
        mm.loadFrameScript("chrome://zotero-browser/content/pdf-frame-script.js", true);
        wrapper._zbPdfMmListener = (msg) => {
          try {
            handlePdfBridgeEvent(msg.data || {});
          } catch (e) {}
        };
        mm.addMessageListener("zb-pdf-event", wrapper._zbPdfMmListener);
        wrapper._zbPdfMmBridgeAttached = true;
      }
    } catch (e) {}
  }

  addTab("about:blank", { reuseBrowser: browser, showHome: true, title: "主页" });

  function dispose() {
    // Dock hosts may be replaced during Zotero pane reloads.  Remove the
    // window-level listeners we own; the host can then be detached safely and
    // BrowserHub.prune() will drop this instance on its next pass.
    try {
      if (ownerWin && wrapper._zbPopupHandler) {
        ownerWin.removeEventListener("DOMPopupBlocked", wrapper._zbPopupHandler, true);
      }
      if (ownerWin && wrapper._zbPdfMessageHandler) {
        ownerWin.removeEventListener("message", wrapper._zbPdfMessageHandler);
      }
    } catch (e) {}
    try {
      if (activeResizeCleanup) {
        activeResizeCleanup();
        activeResizeCleanup = null;
      }
      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
      if (autoTranslateTimer) {
        clearTimeout(autoTranslateTimer);
        autoTranslateTimer = null;
      }
      if (pdfFrame && pdfFrame.messageManager && wrapper._zbPdfMmListener) {
        pdfFrame.messageManager.removeMessageListener("zb-pdf-event", wrapper._zbPdfMmListener);
      }
      for (let tab of tabs) {
        let b = tab && tab.browser;
        if (!b) {
          continue;
        }
        if (wrapper._zbPopupHandler) {
          b.removeEventListener("DOMPopupBlocked", wrapper._zbPopupHandler, true);
        }
        if (b.messageManager) {
          if (b._zbLegacyFrameMessageListener) {
            b.messageManager.removeMessageListener("zb-navigate", b._zbLegacyFrameMessageListener);
          }
          if (b._zbLegacyFrameSelectionListener) {
            b.messageManager.removeMessageListener("zb-selection", b._zbLegacyFrameSelectionListener);
          }
          if (b._zbLegacyPageZoomListener) {
            b.messageManager.removeMessageListener("zb-page-zoom", b._zbLegacyPageZoomListener);
          }
          if (b._zbLegacyFrameZoomListener) {
            b.messageManager.removeMessageListener("zb-pdf-zoomstate", b._zbLegacyFrameZoomListener);
          }
        }
      }
    } catch (e) {}
    for (let callback of disposeCallbacks.splice(0)) {
      try {
        callback();
      } catch (e) {}
    }
    wrapper._zbDisposed = true;
    try {
      if (BrowserHub && Array.isArray(BrowserHub.browsers)) {
        BrowserHub.browsers = BrowserHub.browsers.filter(inst => inst && inst.wrapper !== wrapper);
      }
      BrowserHub.prune();
    } catch (e) {}
  }

  let instance = {
    scope,
    ownerDocument: doc,
    get browser() {
      return browser;
    },
    getBrowsers() {
      return tabs.map(t => t.browser);
    },
    activateBrowser,
    addTab,
    attachTo,
    wrapper,
    openPdf,
    openCite,
    getCleanCurrentUrl,
    toggleToolbars,
    setToolbarsVisible(v) {
      toolbarsVisible = !!v;
      saveToolbarsVisibility(toolbarsVisible);
      updateToolbarsVisibility();
    },
    get toolbarsVisible() {
      return toolbarsVisible;
    },
    applyHeight,
    saveSidebarHeight,
    get sidebarHeight() {
      return currentSidebarHeight;
    }
  };
  wrapper._zbInstance = instance;
  BrowserHub.prune();
  BrowserHub.register(instance);

  applyHeight(currentSidebarHeight);
  ensureThemeStyles();
  applyTheme(getThemeName());
  renderHomeSites();
  renderBookmarks();
  updateToolbarsVisibility();
  showWelcome();
  return instance;
}
