"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const bootstrapSource = fs.readFileSync(
  require("node:path").join(__dirname, "..", "bootstrap.js"),
  "utf8"
);

function extractBalanced(source, start, openChar = "{", closeChar = "}") {
  const open = source.indexOf(openChar, start);
  assert.notEqual(open, -1, "expected a balanced production block");
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === openChar) depth++;
    if (source[index] === closeChar) {
      depth--;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  assert.fail("unterminated production block");
}

function extractFunction(source, start) {
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, "expected a function body");
  const body = extractBalanced(source, open);
  return source.slice(start, open) + body;
}

function loadBrowserHub() {
  const start = bootstrapSource.indexOf("var BrowserHub =");
  assert.notEqual(start, -1, "bootstrap.js must define BrowserHub");
  const object = extractBalanced(bootstrapSource, start);
  return vm.runInNewContext(`(${object})`, {
    Date,
    zbIsPdfUrl(value) { return /^https?:.*\\.pdf(?:$|[?#])/i.test(String(value || "")); }
  });
}

test("BrowserHub tracks connected dock tabs without creating extra instances", () => {
  const hub = loadBrowserHub();
  const doc = { defaultView: { closed: false } };
  const tabBrowser = { browsingContext: {} };
  const dock = { scope: "dock", ownerDocument: doc,
    wrapper: { ownerDocument: doc, isConnected: true }, getBrowsers: () => [tabBrowser] };
  hub.register(dock);
  hub.register(dock);
  assert.equal(hub.browsers.length, 1);
  assert.equal(hub.findByBrowser(tabBrowser), dock);
  assert.equal(hub.findByBrowsingContext(tabBrowser.browsingContext), dock);
});

test("BrowserHub prunes detached sidebar instances and closed documents", () => {
  const hub = loadBrowserHub();
  const openWin = { closed: false };
  const closedWin = { closed: true };
  const openDoc = { defaultView: openWin };
  const closedDoc = { defaultView: closedWin };
  const live = { scope: "sidebar", wrapper: { ownerDocument: openDoc, isConnected: true } };
  const detached = { scope: "sidebar", wrapper: { ownerDocument: openDoc, isConnected: false } };
  const closed = { scope: "dock", wrapper: { ownerDocument: closedDoc, isConnected: true } };
  hub.browsers = [live, detached, closed];
  hub.prune();
  assert.deepEqual(hub.browsers, [live]);
});

test("the existing shortcut resolves to the right panel and keeps legacy preferences", () => {
  const getSource = name => extractFunction(bootstrapSource, bootstrapSource.indexOf("function " + name + "("));
  const main = {};
  let toggles = 0;
  const context = {
    zbResolveDockWindow: () => main,
    zbToggleDock: win => { assert.equal(win, main); toggles++; return true; },
    ZB_SHORTCUTS_PREF: "shortcuts", ZB_TOGGLE_SHORTCUT_DEFAULT: "Mod+Shift+B",
    Zotero: { Prefs: { get: () => JSON.stringify({ toggleGlobalWindow: "Mod+Space" }) } }
  };
  vm.runInNewContext(getSource("toggleRightBrowser") + getSource("zbGetToggleShortcutCombo"), context);
  assert.equal(context.zbGetToggleShortcutCombo(), "Mod+Space");
  context.toggleRightBrowser(main);
  context.toggleRightBrowser(main);
  assert.equal(toggles, 2);
  context.Zotero.Prefs.get = () => JSON.stringify({ toggleBrowserPanel: "", toggleGlobalWindow: "Mod+Space" });
  assert.equal(context.zbGetToggleShortcutCombo(), "", "an explicitly disabled shortcut stays disabled");
  assert.doesNotMatch(bootstrapSource, /registerReaderSelectionPopup|openGlobalBrowserWindow|browser-window\.html/);
});
