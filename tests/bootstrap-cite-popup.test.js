"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../bootstrap.js"), "utf8");
function functions(names, context) {
  for (const name of names) {
    const start = source.indexOf("function " + name + "(");
    const end = source.indexOf("\n}\n", start) + 2;
    vm.runInContext(source.slice(start, end), context);
  }
}

test("the main Cite button resolves the active PDF before the stale library selection and never opens the dock", () => {
  const attachment = { id: 42 }, selected = { id: 99 };
  const win = { Zotero_Tabs: { selectedID: "active-pdf" }, ZoteroPane: { getSelectedItems: () => [selected] } };
  const calls = [];
  const context = vm.createContext({ Zotero: {
    getMainWindow: () => win, Reader: { getByTabID: id => id === "active-pdf" ? { itemID: 42 } : null },
    Items: { get: id => id === 42 ? attachment : null }
  }, zbCitationService: { itemSource: item => ({ itemID: item.id }) }, zbShowCitePopup: (...args) => calls.push(args) });
  functions(["zbCiteCurrentItem", "zbOpenCite"], context);
  context.zbOpenCite(win);
  assert.equal(calls[0][1].itemID, 42); assert.equal(calls[0][2], "zotero");
  win.Zotero_Tabs.selectedID = "zotero-pane";
  context.zbOpenCite(win); assert.equal(calls[1][1].itemID, 99);
});

test("one popup is reused per window; background arXiv loading cannot replace the native PDF citation", () => {
  const appended = [], loads = [], handlers = new Map();
  const win = { document: { documentElement: { appendChild: node => appended.push(node) } },
    addEventListener: (type, fn) => handlers.set(type, fn), removeEventListener: type => handlers.delete(type) };
  let open = false, disposed = false;
  const context = vm.createContext({ zbCitationService: {}, zbCitePopups: new Map(), zbCiteOptions: () => ({}),
    zbCreateCitePopup: () => ({ root: {}, panel: { setSource: s => loads.push(s) },
      show: () => { open = true; }, hide: () => { open = false; }, isOpen: () => open, dispose: () => { disposed = true; } }) });
  functions(["zbShowCitePopup", "zbCitePopupIsOpen", "zbHideCitePopup", "zbClearBrowserCiteSource", "zbDisposeCitePopup"], context);
  const pdf = { identity: "pdf", title: "Current PDF", libraryID: 1 }, online = { identity: "online", title: "Online", libraryID: 1 };
  context.zbShowCitePopup(win, pdf, "zotero");
  context.zbShowCitePopup(win, online, "browser", true);
  assert.deepEqual(loads, [pdf]); assert.equal(context.zbCitePopupIsOpen(win, "zotero"), true);
  context.zbClearBrowserCiteSource(win); assert.deepEqual(loads, [pdf]);
  context.zbHideCitePopup(win);
  context.zbShowCitePopup(win, online, "browser", true);
  assert.deepEqual(loads, [pdf, online]); assert.equal(appended.length, 1);
  context.zbClearBrowserCiteSource(win); assert.equal(loads[2], null);
  context.zbDisposeCitePopup(win); assert.equal(disposed, true); assert.equal(handlers.size, 0); assert.equal(context.zbCitePopups.size, 0);
});

test("main-window toolbar has only browser and Cite icons, removes the old global copy button, and does not duplicate entries", () => {
  const children = [];
  const styles = [];
  const toolbar = { appendChild(node) { children.push(node); }, insertBefore(node, next) {
    const index = next ? children.indexOf(next) : children.length; children.splice(index, 0, node);
  } };
  children.push({ id: "zotero-browser-copy-pdf-toolbar-btn", remove() { children.splice(children.indexOf(this), 1); } });
  const doc = { getElementById: id => id === "zotero-toolbar" ? toolbar : [...children, ...styles].find(n => n.id === id),
    documentElement: { appendChild: node => styles.push(node) }, createElement: () => ({}),
    createXULElement: () => ({ style: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener() {}, get nextSibling() { return children[children.indexOf(this) + 1] || null; } }) };
  const start = source.indexOf('  let toolbar = doc.getElementById("zotero-toolbar")');
  const end = source.indexOf("  if (!win._zoteroBrowserKeyHandler)", start);
  const context = vm.createContext({ doc, win: {}, zbComboLabel: () => "shortcut", zbGetToggleShortcutCombo: () => "shortcut" });
  const inject = new vm.Script("(() => {" + source.slice(start, end) + "})()");
  inject.runInContext(context);
  assert.deepEqual(children.map(n => n.id), ["zotero-browser-toolbar-btn", "zotero-browser-cite-toolbar-btn"]);
  assert.ok(children.every(n => !n.attributes.label && n.attributes["aria-label"]));
  inject.runInContext(context); assert.equal(children.length, 2); assert.equal(styles.length, 1);
});

test("reader toolbar retains copy PDF and uses bounded SVG icons with accessible names for all three buttons", () => {
  let handler;
  const buttons = [], actions = [], win = {};
  const ctx = vm.createContext({ zbReaderToolbarHandler: null, zbCitationService: {}, pluginID: "test",
    Zotero: { Reader: { registerEventListener: (_name, fn) => { handler = fn; } }, Items: { get: id => ({ id }) } },
    zbReaderPaperTitle: () => "Paper", zbSetDockContextTitle() {},
    zbCopyPDFFile: (_win, item) => actions.push(["copy", item.id]), zbOpenCite: (_win, item) => actions.push(["cite", item.id]),
    toggleRightBrowser: () => actions.push(["browser"]), dump: error => { throw new Error(error); }
  });
  functions(["zbToolbarIcon", "registerReaderToolbarButton"], ctx);
  ctx.registerReaderToolbarButton();
  const doc = { createElement: () => ({ style: {}, attributes: {}, events: {}, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(k, fn) { this.events[k] = fn; } }) };
  handler({ reader: { _window: win, itemID: 42 }, doc, append: button => buttons.push(button) });
  assert.deepEqual(buttons.map(b => b.id), ["zb-reader-copy-pdf-btn", "zb-reader-browser-btn", "zb-reader-cite-btn"]);
  for (const button of buttons) {
    assert.match(button.innerHTML, /width="18" height="18"/); assert.ok(button.attributes["aria-label"]); assert.equal(button.textContent, undefined);
  }
  buttons[0].events.click(); buttons[2].events.click();
  assert.deepEqual(actions, [["copy", 42], ["cite", 42]]);
});
