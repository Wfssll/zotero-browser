"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../content/sidebar-browser.js"), "utf8");
function extract(name, endMarker = "\n}\n") {
  const start = source.indexOf("function " + name + "(");
  return source.slice(start, source.indexOf(endMarker, start) + endMarker.length);
}
function node(tag) {
  return { tag, value: "", style: {}, children: [], events: {}, attributes: {},
    appendChild(child) { this.children.push(child); }, setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(k, fn) { this.events[k] = fn; } };
}

test("home search opens URLs and encoded queries using the selected engine, without depending on the top input", () => {
  const urls = [];
  const engines = [{ id: "google", name: "Google", url: "https://www.google.com/search?q=%s" }, { id: "bing", name: "必应", url: "https://www.bing.com/search?q=%s" }];
  const engineSelect = { value: "google" };
  const context = vm.createContext({ engines, engineSelect, urlInput: { value: "stale address" }, navigate: url => urls.push(url) });
  vm.runInContext(extract("zbCreateHomeSearch") + extract("handleSearchOrUrl", "\n  }"), context);
  const search = context.zbCreateHomeSearch({ createElement: node }, {
    engines, getEngine: () => engineSelect.value, setEngine: id => { engineSelect.value = id; }, submit: value => context.handleSearchOrUrl(value)
  });
  search.input.value = "宇宙 A&B";
  search.input.events.keydown({ key: "Enter", preventDefault() {} });
  assert.equal(urls[0], "https://www.google.com/search?q=" + encodeURIComponent("宇宙 A&B"));
  search.engine.value = "bing"; search.engine.events.change();
  search.input.value = "dark energy"; search.root.children[2].events.click();
  assert.equal(urls[1], "https://www.bing.com/search?q=dark%20energy");
  search.input.value = "arxiv.org/pdf/2609.36355";
  search.root.events.submit({ preventDefault() {} });
  assert.equal(urls[2], "https://arxiv.org/pdf/2609.36355");
  search.input.value = " "; search.root.children[2].events.click(); assert.equal(urls.length, 3);
  search.input.value = "输入中"; search.input.events.keydown({ key: "Enter", isComposing: true }); assert.equal(urls.length, 3);
});
