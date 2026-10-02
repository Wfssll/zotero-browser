"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const makePanel = vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../content/cite-ui.js"), "utf8") + "\nzbCreateCitePanel;", {});
const makePopup = vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../content/cite-ui.js"), "utf8") + "\nzbCreateCitePopup;", {});

function document() {
  const nodes = [];
  return { nodes, events: {}, addEventListener(type, fn) { this.events[type] = fn; },
    removeEventListener(type, fn) { if (this.events[type] === fn) delete this.events[type]; },
    createTextNode: text => ({ textContent: text }), createElement(tag) {
    const node = { tag, style: {}, children: [], attrs: {}, events: {}, value: "", disabled: false,
      appendChild(child) { this.children.push(child); }, setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(type, action) { this.events[type] = action; },
      remove() { this.removed = true; },
      async click() { if (!this.disabled) await this.events.click?.(); } };
    nodes.push(node); return node;
  } };
}

test("the internal Cite popup floats independently and closes with Escape or its close button", () => {
  const doc = document();
  const popup = makePopup(doc, {}, { hasToken: () => false });
  assert.match(popup.root.style.cssText, /position:fixed/);
  assert.match(popup.root.style.cssText, /max-height:calc\(100vh/);
  assert.equal(popup.root.attrs.role, "dialog");
  popup.hide(); assert.equal(popup.isOpen(), false);
  popup.show(); assert.equal(popup.isOpen(), true);
  let prevented = false;
  doc.events.keydown({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true); assert.equal(popup.isOpen(), false);
  popup.show();
  doc.nodes.find(n => n.attrs["aria-label"] === "关闭 Cite").events.click();
  assert.equal(popup.isOpen(), false);
  popup.dispose(); assert.equal(popup.root.removed, true); assert.equal(doc.events.keydown, undefined);
});
const result = id => ({ title: id, bibcode: id, bibtex: "@ARTICLE{" + id + ", title={" + id + "}}", adsURL: "https://ui.adsabs.harvard.edu/abs/" + id });
function setup(service) {
  const doc = document(), copied = [], exported = [];
  const options = { getPane: () => ({}), getSource: () => ({ title: "current" }), sourceFromInput: value => ({ title: value }),
    copy: value => copied.push(value), exportFile: value => exported.push(value), getAutoCopy: () => false,
    setAutoCopy() {}, hasToken: () => false, setToken() {}, openURL() {} };
  const panel = makePanel(doc, { stored: async () => null, ...service }, options);
  return { panel, doc, copied, exported, button: label => doc.nodes.find(n => n.tag === "button" && n.textContent === label),
    text: doc.nodes.find(n => n.tag === "textarea") };
}

test("late responses cannot replace the new tab's citation or reach the clipboard", async () => {
  const resolvers = new Map();
  const h = setup({ retrieve: source => new Promise(resolve => resolvers.set(source.title, resolve)) });
  h.doc.nodes.filter(n => n.tag === "input" && n.type === "checkbox")[0].checked = true;
  const old = h.panel.load({ title: "old" });
  const current = h.panel.load({ title: "current" });
  resolvers.get("current")(result("current")); await current;
  resolvers.get("old")(result("old")); await old;
  assert.equal(h.text.value, result("current").bibtex);
  assert.deepEqual(h.copied, [result("current").bibtex]);
});

test("manual copy and file export use the visible result, and failures disable saving", async () => {
  const h = setup({ retrieve: async source => {
    if (source.title === "error") throw new Error("not indexed"); return result(source.title);
  } });
  await h.panel.load({ title: "paper" });
  await h.button("复制 BibTeX").click(); await h.button("另存 .bib").click();
  assert.deepEqual(h.copied, [result("paper").bibtex]); assert.deepEqual(h.exported, h.copied);
  await h.panel.load({ title: "error" });
  assert.equal(h.button("保存独立 Cite 笔记").disabled, true);
  assert.equal(h.button("复制 BibTeX").disabled, true); assert.equal(h.text.value, "");
});

test("batch retry handles only failed and unfinished papers, retaining earlier successful exports", async () => {
  const sources = [{ title: "A", identity: "A" }, { title: "B", identity: "B" }, { title: "C", identity: "C" }];
  const attempts = [];
  const h = setup({ targets: async () => sources, combine: results => results.map(r => r.bibcode).join(","),
    batch: async queue => {
      attempts.push(queue.map(s => s.title));
      if (attempts.length === 1) return { total: 3, completed: [{ source: sources[0], result: result("A") }], failed: [{ source: sources[1], error: "not indexed" }], stopped: true };
      if (attempts.length === 2) return { total: 2, completed: [{ source: sources[1], result: result("B") }], failed: [{ source: sources[2], error: "network" }] };
      return { total: 1, completed: [{ source: sources[2], result: result("C") }], failed: [] };
    } });
  await h.button("获取并逐篇保存").click();
  await h.button("重试失败／未完成").click();
  await h.button("重试失败／未完成").click();
  assert.deepEqual(attempts, [["A", "B", "C"], ["B", "C"], ["C"]]);
  await h.button("复制本次全部 BibTeX").click();
  assert.deepEqual(h.copied, ["A,B,C"]); assert.equal(h.button("重试失败／未完成").disabled, true);
});

test("disposing a panel invalidates in-flight results", async () => {
  let resolve;
  const h = setup({ retrieve: () => new Promise(r => { resolve = r; }) });
  h.doc.nodes.filter(n => n.tag === "input" && n.type === "checkbox")[0].checked = true;
  const pending = h.panel.load({ title: "A" }); h.panel.dispose(); resolve(result("A")); await pending;
  assert.equal(h.text.value, ""); assert.equal(h.copied.length, 0);
});
