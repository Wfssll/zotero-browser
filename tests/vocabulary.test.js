"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createService } = require("../content/vocabulary.js");

// In-memory Zotero adapter; production logic runs unchanged.
function host() {
  const items = new Map();
  let nextID = 1;
  let requests = 0;
  const listeners = new Map();
  class Item {
    constructor(type) { this.type = type; this.tags = []; this.html = ""; this.libraryID = 1; }
    isAttachment() { return this.type === "attachment"; }
    getField() { return this.title; }
    getCollections() { return this.collections || []; }
    setCollections(ids) { this.collections = ids; }
    addRelatedItem(item) { this.related = item; }
    addTag(tag) { this.tags.push(tag); }
    hasTag(tag) { return this.tags.includes(tag); }
    getNote() { return this.html; }
    setNote(html) { this.html = html; }
    async saveTx() { if (!this.id) this.id = nextID++; items.set(this.id, this); return this.id; }
  }
  const decode = html => html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  class Parser {
    parseFromString(html) {
      return { querySelectorAll: () => [...html.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)].map(match => ({
        querySelectorAll: () => [...match[1].matchAll(/<p>([\s\S]*?)<\/p>/g)].map(p => ({ textContent: decode(p[1]) }))
      })) };
    }
  }
  const Z = {
    Item, Items: { get: id => items.get(id), getAsync: async id => items.get(id) },
    Libraries: { get: id => ({ editable: id !== 3, libraryType: id === 2 ? "group" : "user", libraryTypeID: 456 }) },
    Utilities: { Internal: { md5: text => crypto.createHash("md5").update(text).digest("hex") } },
    Search: class {
      addCondition(name, op, value) { if (name === "tag") this.tag = value; }
      async search() { return [...items.values()].filter(i => i.type === "note" && i.libraryID === this.libraryID && i.hasTag(this.tag)).map(i => i.id); }
    },
    Reader: { registerEventListener: (type, fn) => listeners.set(type, fn), unregisterEventListener: type => listeners.delete(type) },
    Promise: { delay: async () => {} }, getMainWindow: () => ({ DOMParser: Parser }), debug() {},
    PDFTranslate: { data: { translate: { queue: [] } }, api: { translate: async (text, options) => {
      requests++; return { result: "中文 " + text, status: "success", langto: options.langto };
    } } }
  };
  function attachment(title, libraryID = 1, parentID) {
    const item = new Item("attachment");
    Object.assign(item, { title, libraryID, parentID, id: nextID++, key: "PDF" + nextID });
    items.set(item.id, item); return item;
  }
  return { Z, items, attachment, listeners, service: createService(Z), requests: () => requests };
}

test("a PDF gets one independent note, with escaped bilingual text, collection, relationship and page link", async () => {
  const h = host();
  const paper = h.attachment("Paper & title"); paper.collections = [12];
  const pdf = h.attachment("Full text", 1, paper.id);
  const source = h.service.readerSource({ itemID: pdf.id }, { pageLabel: "iv", position: { pageIndex: 3 } });
  const { note } = await h.service.save(source, '<word> & "quote"', "中文 & 译文");
  assert.equal(note.parentID, undefined);
  assert.deepEqual(note.collections, [12]);
  assert.equal(note.related, paper);
  assert.match(note.html, /&lt;word&gt; &amp; &quot;quote&quot;/);
  assert.match(note.html, /中文 &amp; 译文/);
  assert.match(note.html, /\?page=4/);
  assert.match(note.html, /第 iv 页/);
  await h.service.save(source, "second word", "另一个词");
  assert.equal([...h.items.values()].filter(i => i.type === "note").length, 1);
  assert.equal((note.html.match(/<blockquote>/g) || []).length, 2);
  // A fresh service rediscovers the saved note after a plugin restart.
  const again = await createService(h.Z).save(source, '<word> & "quote"', "中文 & 译文");
  assert.equal(again.note.id, note.id);
  assert.equal(again.duplicate, true);
});

test("simultaneous clicks serialize additions and deduplicate without lost entries", async () => {
  const h = host();
  const pdf = h.attachment("Paper");
  const source = h.service.readerSource({ itemID: pdf.id });
  const results = await Promise.all([
    h.service.save(source, "hello", "你好"), h.service.save(source, "hello", "你好"), h.service.save(source, "world", "世界")
  ]);
  assert.equal(new Set(results.map(r => r.note.id)).size, 1);
  assert.equal(results[1].duplicate, true);
  assert.equal((results[0].note.html.match(/<blockquote>/g) || []).length, 2);
});

test("different PDFs and libraries remain separate; read-only and empty translations never save", async () => {
  const h = host();
  const a = h.service.readerSource({ itemID: h.attachment("A").id });
  const b = h.service.readerSource({ itemID: h.attachment("B", 2).id });
  const first = await h.service.save(a, "word", "词");
  const second = await h.service.save(b, "word", "词");
  assert.notEqual(first.note.id, second.note.id);
  assert.equal(second.note.libraryID, 2);
  assert.match(second.note.html, /zotero:\/\/open-pdf\/groups\/456\/items\//);
  await assert.rejects(h.service.save({ ...a, libraryID: 3 }, "word", "词"), /只读/);
  await assert.rejects(h.service.save(a, "word", ""), /不能为空/);
  assert.equal([...h.items.values()].filter(i => i.type === "note").length, 2);
});

test("translation reuse requires the same PDF and exact selection; missing or non-Chinese results use the public API", async () => {
  const h = host();
  const source = h.service.readerSource({ itemID: h.attachment("A").id });
  const queue = h.Z.PDFTranslate.data.translate.queue;
  queue.push({ type: "text", itemId: source.itemID, raw: "hello\nworld", result: "你好世界", status: "success", langto: "zh-CN" });
  queue.push({ type: "text", itemId: 999, raw: "hello world", result: "错误归属", status: "success" });
  assert.equal(await h.service.translation(source, "hello world"), "你好世界");
  assert.equal(h.requests(), 0);
  queue[0].langto = "fr";
  assert.equal(await h.service.translation(source, "hello world"), "中文 hello world");
  assert.equal(h.requests(), 1);
  queue.length = 0;
  h.Z.PDFTranslate.api.translate = async () => ({ status: "fail", result: "service error" });
  await assert.rejects(h.service.translation(source, "hello"), /翻译失败/);
});

test("the reader save button captures its PDF before tab changes, and unregisters cleanly", async () => {
  const h = host();
  const a = h.attachment("A"), b = h.attachment("B");
  const reader = { itemID: a.id };
  const makeElement = () => ({ style: {}, children: [], setAttribute() {}, appendChild(child) { this.children.push(child); },
    addEventListener(type, fn) { this[type] = fn; } });
  let controls;
  h.service.registerReader("plugin");
  h.listeners.get("renderTextSelectionPopup")({ reader, params: { annotation: { text: "hello" } },
    doc: { createElement: makeElement }, append(node) { controls = node; } });
  reader.itemID = b.id;
  await controls.children[0].click({ preventDefault() {}, stopPropagation() {} });
  const note = [...h.items.values()].find(i => i.type === "note");
  assert.match(note.html, /生词与句子 — A/);
  assert.equal(note.related, a);
  h.service.unregisterReader();
  assert.equal(h.listeners.size, 0);
});

test("online PDF previews use their URL identity, without attaching words to an unrelated reader", async () => {
  const h = host();
  const source = h.service.previewSource("https://arxiv.org/pdf/1234.56789", "Online PDF", 1, [12], 5);
  const { note } = await h.service.save(source, "online", "在线");
  assert.equal(note.related, undefined);
  assert.match(note.html, /https:\/\/arxiv.org\/pdf\/1234.56789/);
  assert.match(note.html, /第 5 页/);
});
