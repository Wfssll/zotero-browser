"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "bootstrap.js"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `bootstrap.js must define ${name}`);
  const paramsClose = source.indexOf(")", start);
  const open = source.indexOf("{", paramsClose);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated ${name}`);
}

function loadClamp() {
  return new Function(
    "ZB_DOCK_DEFAULT_WIDTH", "ZB_DOCK_MIN_WIDTH", "ZB_DOCK_MAX_WIDTH",
    `return (${extractFunction("zbDockClampWidth")});`
  )(430, 280, 920);
}

test("dock width clamps to safe bounds and leaves room for Zotero's main content", () => {
  const clamp = loadClamp();
  const narrow = { document: { getElementById: () => ({ getBoundingClientRect: () => ({ width: 500 }) }) } };
  const wide = { document: { getElementById: () => ({ getBoundingClientRect: () => ({ width: 1400 }) }) } };
  assert.equal(clamp("not-a-number", wide), 430);
  assert.equal(clamp(120, wide), 280);
  assert.equal(clamp(1000, wide), 920);
  assert.equal(clamp(900, narrow), 233);
  assert.equal(500 - 7 - clamp(900, narrow), 260, "reserve main content plus divider width");
});

test("dock collapse hides the host while preserving the configured expanded width", () => {
  const writes = [];
  const setCollapsed = new Function(
    "ZB_DOCK_COLLAPSED_WIDTH", "zbDockSaveCollapsed", "zbDockClampWidth",
    `return (${extractFunction("zbDockSetCollapsed")});`
  )(0, value => writes.push(value), loadClamp());
  const state = {
    collapsed: false,
    width: 430,
    root: { style: {}, setAttribute(name, value) { this[name] = value; } },
    splitter: { style: {} },
    host: { style: {} },
    collapseButton: { style: {}, setAttribute(name, value) { this[name] = value; } },
    contextLabel: { style: {} },
    globalButton: { style: {} }
  };
  setCollapsed(state, true, true);
  assert.equal(state.root.style.width, "0px");
  assert.equal(state.root.style.display, "none");
  assert.equal(state.splitter.style.display, "none");
  assert.equal(state.host.style.display, "none");
  assert.equal(state.root["data-collapsed"], "true");
  assert.deepEqual(writes, [true]);
  setCollapsed(state, false, false);
  assert.equal(state.root.style.width, "430px");
  assert.equal(state.root.style.display, "flex");
  assert.equal(state.splitter.style.display, "block");
  assert.equal(state.host.style.display, "flex");
  assert.equal(state.root["data-collapsed"], "false");
  setCollapsed(state, true, false);
  state.window = { document: { getElementById: () => ({ getBoundingClientRect: () => ({ width: 500 }) }) } };
  setCollapsed(state, false, false);
  assert.equal(state.root.style.width, "233px", "reopening after window resize must re-clamp");
});

test("missing dock host retries are bounded and do not start nested retry chains", () => {
  const timers = new Map();
  let nextID = 1;
  let lookups = 0;
  const win = {
    closed: false,
    document: { documentURI: "chrome://zotero/content/zoteroPane.xhtml", getElementById: () => null },
    setTimeout(fn) { const id = nextID++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const context = {
    zbFindMainDockPlacement() { lookups++; return null; },
    zbDockStates: new Map()
  };
  vm.createContext(context);
  for (const name of ["zbScheduleDockRetry", "zbEnsureDockForWindow", "zbDockRemoveForWindow"]) {
    vm.runInContext(extractFunction(name), context);
  }
  context.zbScheduleDockRetry(win);
  for (let i = 0; timers.size && i < 30; i++) {
    assert.equal(timers.size, 1);
    const [id, fn] = timers.entries().next().value;
    timers.delete(id);
    fn();
  }
  assert.equal(lookups, 12);
  assert.equal(timers.size, 0);
  context.zbScheduleDockRetry(win);
  context.zbDockRemoveForWindow(win);
  assert.equal(timers.size, 0, "unload cancels retries even before any dock exists");
});

test("reopening the main-window dock preserves the browser instance and host", () => {
  const container = {};
  const win = { document: {} };
  const placement = { container, doc: win.document };
  let creations = 0;
  let initializations = 0;
  const instance = { wrapper: { addEventListener() {} } };
  const context = {
    zbDockStates: new Map(),
    zbFindMainDockPlacement: () => placement,
    zbDockCreateState() {
      creations++;
      return { window: win, doc: win.document, root: { parentNode: container },
        host: { querySelector: () => null }, instance: null, contextTitle: "Paper A" };
    },
    loadSidebarScript() {},
    initSidebarBrowser() { initializations++; return instance; },
    zbDockConfigureInstance() {},
    zbDockApplyContextTitle(state, title) { state.contextTitle = title; },
    dump() {}
  };
  vm.createContext(context);
  vm.runInContext(extractFunction("zbDockInstantiate"), context);
  vm.runInContext(extractFunction("zbEnsureDockForWindow"), context);
  const first = context.zbEnsureDockForWindow(win);
  first.contextTitle = "Paper B";
  const second = context.zbEnsureDockForWindow(win);
  assert.equal(second, first);
  assert.equal(second.instance, instance);
  assert.equal(second.host, first.host);
  assert.equal(creations, 1);
  assert.equal(initializations, 1);
});
