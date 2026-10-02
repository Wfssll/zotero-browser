"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "sidebar-browser.js"),
  "utf8"
);
const legacyBrowserSource = fs.readFileSync(
  path.join(__dirname, "..", "content", "browser.js"),
  "utf8"
);
const legacyBrowserMarkup = fs.readFileSync(
  path.join(__dirname, "..", "content", "browser.html"),
  "utf8"
);

function extractArray(marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `production ${marker} must exist`);
  const open = source.indexOf("[", start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "[") depth++;
    if (source[index] === "]") {
      depth--;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  assert.fail("unterminated production array");
}

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `production helper ${name} must exist`);
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
  assert.fail(`unterminated production helper ${name}`);
}

test("sidebar search exposes only plain-text Google and Bing choices", () => {
  const engines = vm.runInNewContext(`(${extractArray("const engines =")})`);
  assert.deepEqual(Array.from(engines, engine => engine.id), ["google", "bing"]);
  assert.deepEqual(Array.from(engines, engine => engine.name), ["Google", "必应"]);
  assert.ok(engines.every(engine => !/[\u{1F300}-\u{1FAFF}]/u.test(engine.name)));
});

test("legacy browser entry keeps the same two search engines and plain-text labels", () => {
  const objectStart = legacyBrowserSource.indexOf("const SEARCH_ENGINES =");
  assert.notEqual(objectStart, -1);
  const open = legacyBrowserSource.indexOf("{", objectStart);
  const close = legacyBrowserSource.indexOf("};", open);
  const engines = vm.runInNewContext(`(${legacyBrowserSource.slice(open, close + 1)})`);
  assert.deepEqual(Object.keys(engines).sort(), ["bing", "google"]);
  const options = [...legacyBrowserMarkup.matchAll(/<option\s+value="([^"]+)">([^<]*)<\/option>/g)];
  assert.deepEqual(options.map(option => option[1]), ["google", "bing"]);
  assert.deepEqual(options.map(option => option[2]), ["Google", "必应"]);
});

test("invalid persisted search engine values migrate to Google and valid IDs persist", () => {
  const engines = vm.runInNewContext(`(${extractArray("const engines =")})`);
  const writes = [];
  const loadSearchEngine = new Function(
    "engines", "PREF_SEARCH_ENGINE", "Zotero",
    `return (${extractFunction("loadSearchEngine")});`
  )(engines, "extensions.zotero-browser.searchEngine", {
    Prefs: { get: () => "arxiv", set: (...args) => writes.push(args) }
  });
  assert.equal(loadSearchEngine(), "google");
  assert.deepEqual(writes, [["extensions.zotero-browser.searchEngine", "google", true]]);
});

test("search query uses encodeURIComponent while direct URLs remain unchanged", () => {
  const engines = vm.runInNewContext(`(${extractArray("const engines =")})`);
  const urlInput = { value: "中文 题名 &" };
  const engineSelect = { value: "google" };
  const navigated = [];
  const handleSearchOrUrl = new Function(
    "urlInput", "engineSelect", "engines", "navigate",
    `return (${extractFunction("handleSearchOrUrl")});`
  )(urlInput, engineSelect, engines, value => navigated.push(value));
  handleSearchOrUrl();
  assert.equal(navigated[0], "https://www.google.com/search?q=%E4%B8%AD%E6%96%87%20%E9%A2%98%E5%90%8D%20%26");
  urlInput.value = "https://example.com/path?q=1&x=2";
  handleSearchOrUrl();
  assert.equal(navigated[1], urlInput.value);
});
