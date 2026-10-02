"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const { createService, arxivID, doiID, adsBibcode, sourceFromURL } = require("../content/citation.js");

const bibcode = "2026arXiv260936355G";
const bibtex = "@ARTICLE{" + bibcode + ",\n title = {A <paper> & result},\n eprint = {2609.36355}\n}\n";
const record = { bibcode, title: ["A paper"], identifier: ["arXiv:2609.36355"], doi: [] };

// Small note-DOM adapter; real Zotero DOMParser is also checked live.
const escape = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decode = t => t.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
class Parser {
  parseFromString(html) {
    const nodes = {};
    for (const tag of ["h1", "p", "pre", "a"]) nodes[tag] = [...html.matchAll(new RegExp('<' + tag + '([^>]*)>([\\s\\S]*?)</' + tag + '>', 'g'))].map(m => {
      const node = { tag, attrs: m[1], content: m[2], start: m.index, original: m[0], changed: false,
        get textContent() { return decode(this.content); }, set textContent(t) { this.content = escape(t); this.changed = true; },
        getAttribute(name) { return decode(this.attrs.match(new RegExp(name + '="([^"]*)"'))?.[1] || ""); },
        setAttribute(name, value) { this.attrs = this.attrs.replace(new RegExp(name + '="[^"]*"'), name + '="' + escape(value) + '"'); this.changed = true; } };
      return node;
    });
    return { querySelectorAll: selector => nodes[selector] || [], querySelector: selector => (nodes[selector.startsWith("a[") ? "a" : selector] || [])[0],
      body: { get innerHTML() {
        let output = html;
        for (const node of Object.values(nodes).flat().filter(n => n.changed).sort((a, b) => b.start - a.start)) {
          output = output.slice(0, node.start) + '<' + node.tag + node.attrs + '>' + node.content + '</' + node.tag + '>' + output.slice(node.start + node.original.length);
        }
        return output;
      } } };
  }
}

function host(options = {}) {
  const items = new Map(), calls = [];
  let id = 10;
  class Item {
    constructor(type = "note") { this.type = type; this.html = ""; this.tags = []; this.libraryID = 1; this.fields = {}; }
    isRegularItem() { return this.type === "journalArticle"; }
    getField(name) { return this.fields[name] || ""; }
    getCollections() { return this.collections || []; }
    setCollections(value) { this.collections = value; }
    addRelatedItem(item) { this.related = item; }
    addTag(tag) { this.tags.push(tag); }
    hasTag(tag) { return this.tags.includes(tag); }
    getNote() { return this.html; }
    setNote(html) { this.html = html; }
    async saveTx() { if (!this.id) this.id = ++id; items.set(this.id, this); return this.id; }
  }
  const Z = { Item,
    Items: { get: key => items.get(key), getAsync: async key => items.get(key), getAll: async library => [...items.values()].filter(i => i.libraryID === library && !i.deleted) },
    Collections: { get: key => options.collections?.get(key) },
    Libraries: { get: key => ({ editable: key !== 3 }) },
    Utilities: { Internal: { md5: t => crypto.createHash("md5").update(t).digest("hex") } },
    Search: class { addCondition(name, op, value) { if (name === "tag") this.tag = value; }
      async search() { return [...items.values()].filter(i => i.type === "note" && i.libraryID === this.libraryID && i.hasTag(this.tag)).map(i => i.id); } },
    getMainWindow: () => ({ DOMParser: Parser }), Promise: { delay: async () => {} }
  };
  const request = async (method, url, config) => {
    calls.push({ method, url, config });
    if (options.request) return options.request(method, url, config, calls);
    if (url.endsWith("bootstrap")) return { status: 200, data: { access_token: "guest-test", expires_at: Date.now() / 1000 + 3600 } };
    if (url.includes("search/query")) return { status: 200, data: { response: { numFound: 1, docs: [record] } } };
    return { status: 200, data: { export: bibtex } };
  };
  function paper(title = "A paper", fields = {}, libraryID = 1) {
    const item = new Item("journalArticle");
    Object.assign(item, { id: ++id, key: "KEY" + id, fields: { title, ...fields }, libraryID, collections: [12] }); items.set(item.id, item); return item;
  }
  return { Z, items, calls, paper, service: createService(Z, { request, getToken: options.getToken }), request };
}

test("canonical arXiv IDs include versions, old IDs and query strings, while foreign hosts are rejected", () => {
  assert.equal(arxivID("https://arxiv.org/pdf/2609.36355v2.pdf?download=1"), "2609.36355");
  assert.equal(arxivID("https://export.arxiv.org/abs/astro-ph/9701234v3"), "astro-ph/9701234");
  assert.equal(arxivID("arXiv:2609.36355"), "2609.36355");
  assert.equal(arxivID("https://arxiv.org.evil/pdf/2609.36355"), null);
  assert.equal(arxivID("https://evil/arxiv.org/pdf/2609.36355"), null);
  assert.equal(doiID("https://doi.org/10.1234/a-b"), "10.1234/a-b");
  assert.equal(adsBibcode("https://ui.adsabs.harvard.edu/abs/2026arXiv260936355G/exportcitation"), bibcode);
  assert.throws(() => sourceFromURL("https://example.com", 1), /请输入/);
  // Plugin bootstrap sandboxes do not necessarily provide a global URL.
  const code = fs.readFileSync(require.resolve("../content/citation.js"), "utf8");
  const sandbox = vm.runInNewContext(code + "\nzbCitation;", {});
  assert.equal(sandbox.arxivID("https://arxiv.org/pdf/2609.36355"), "2609.36355");
});

test("the public guest route retrieves exact ADS text with all authors and coalesces duplicate requests", async () => {
  const h = host(); const source = sourceFromURL("https://arxiv.org/pdf/2609.36355", 1);
  const [a, b] = await Promise.all([h.service.retrieve(source), h.service.retrieve(source)]);
  assert.equal(a.bibtex, bibtex); assert.equal(a, b); assert.equal(h.calls.length, 3);
  const search = h.calls.find(c => c.url.includes("search/query"));
  assert.match(decodeURIComponent(search.url), /identifier:"arXiv:2609\.36355"/);
  const payload = JSON.parse(h.calls[2].config.body);
  assert.equal(payload.maxauthor, 0); assert.deepEqual(payload.bibcode, [bibcode]);
  assert.match(h.calls[2].url, /^https:\/\/ui\.adsabs\.harvard\.edu\/v1\/export\/bibtex/);
  await h.service.retrieve(source); assert.equal(h.calls.length, 3);
});

test("personal Tokens use the developer API; expired guest authentication refreshes only once", async () => {
  const personal = host({ getToken: () => "personal-test" });
  await personal.service.retrieve(sourceFromURL("https://arxiv.org/pdf/2609.36355", 1));
  assert.equal(personal.calls.length, 2);
  assert.match(personal.calls[0].url, /^https:\/\/api\.adsabs\.harvard\.edu/);
  let bootstraps = 0, searches = 0;
  const h = host({ request: async (method, url) => {
    if (url.endsWith("bootstrap")) return { status: 200, data: { access_token: "guest" + ++bootstraps } };
    if (url.includes("search/query")) return ++searches === 1 ? { status: 401 } : { status: 200, data: { response: { numFound: 1, docs: [record] } } };
    return { status: 200, data: { export: bibtex } };
  } });
  await h.service.retrieve(sourceFromURL("https://arxiv.org/pdf/2609.36355", 1));
  assert.equal(bootstraps, 2); assert.equal(searches, 2);
});

test("missing, ambiguous, wrong-record and invalid export responses never become citations", async () => {
  for (const docs of [[], [record, { ...record, bibcode: "2026arXiv260936355X" }], [{ ...record, identifier: ["arXiv:0001.00001"] }]]) {
    const h = host({ getToken: () => "token", request: async () => ({ status: 200, data: { response: { numFound: docs.length, docs } } }) });
    await assert.rejects(h.service.retrieve(sourceFromURL("https://arxiv.org/pdf/2609.36355", 1)), /未找到|多个/);
    assert.equal(h.items.size, 0);
  }
  const h = host({ getToken: () => "token", request: async (method) => method === "GET" ?
    { status: 200, data: { response: { numFound: 1, docs: [record] } } } : { status: 200, data: { export: "@ARTICLE{wrong, title={Wrong}}" } } });
  await assert.rejects(h.service.retrieve(sourceFromURL("https://arxiv.org/pdf/2609.36355", 1)), /不匹配/);
});

test("item matching prefers identifiers and accepts a title only when it matches exactly", async () => {
  const h = host({ getToken: () => "token", request: async (method, url) => {
    if (method === "POST") return { status: 200, data: { export: bibtex } };
    const q = decodeURIComponent(url);
    return { status: 200, data: { response: { numFound: q.includes("doi:") ? 0 : 1,
      docs: q.includes("doi:") ? [] : [{ ...record, title: ["{A paper}"] }] } } };
  } });
  const item = h.paper("A paper", { DOI: "10.1234/example" });
  const result = await h.service.retrieve(h.service.itemSource(item));
  assert.equal(result.bibcode, bibcode);
  assert.match(decodeURIComponent(h.calls[0].url), /doi:"10\.1234\/example"/);
  assert.match(decodeURIComponent(h.calls[1].url), /title:"A paper"/);
});

test("Cite notes persist separately, update in place, preserve user text and reload offline", async () => {
  const h = host(); const item = h.paper("A paper", { url: "https://arxiv.org/abs/2609.36355" });
  const source = h.service.itemSource(item), result = await h.service.retrieve(source);
  const first = await h.service.save(source, result);
  assert.equal(first.created, true); assert.equal(first.note.parentID, undefined); assert.equal(first.note.related, item);
  assert.match(first.note.html, /Cite — A paper/); assert.match(first.note.html, /&lt;paper&gt; &amp; result/);
  assert.match(first.note.tags[0], /^zotero-browser:cite:/); assert.doesNotMatch(first.note.tags[0], /vocabulary/);
  first.note.html = first.note.html.replace(/<\/div>$/, "<p>My own note</p></div>");
  const second = await h.service.save(source, result);
  assert.equal(second.note.id, first.note.id); assert.equal(second.created, false); assert.match(second.note.html, /My own note/);
  const offline = createService(h.Z, { request: async () => { throw new Error("must not access network"); } });
  const stored = await offline.retrieve(source); assert.equal(stored.bibtex, bibtex); assert.equal(stored.saved, true);
  // Changed identifiers invalidate the saved citation instead of returning the wrong paper.
  const changed = { ...source, arxiv: "2609.00001" };
  await assert.rejects(offline.retrieve(changed), /must not access network/);
  await assert.rejects(h.service.save({ ...source, libraryID: 3 }, result), /只读/);
});

test("scope selection includes child collections, deduplicates papers and excludes notes and trash", async () => {
  const collections = new Map(); const h = host({ collections });
  const a = h.paper("A"), b = h.paper("B"), trash = h.paper("Trash"); trash.deleted = true;
  const note = new h.Z.Item("note"); note.id = 99; h.items.set(99, note);
  const attachment = { id: 100, parentID: a.id }; h.items.set(100, attachment);
  const child = { id: 2, getChildItems: () => [a, b] };
  const collection = { id: 1, getChildItems: () => [a, note], getDescendents: () => [{ id: 2 }] };
  collections.set(2, child);
  const pane = { getSelectedLibraryID: () => 1, getSelectedCollection: () => collection, getSelectedItems: () => [attachment, a, b] };
  assert.deepEqual((await h.service.targets("selected", pane)).map(s => s.itemID), [a.id, b.id]);
  assert.deepEqual((await h.service.targets("collection", pane, true)).map(s => s.itemID), [a.id, b.id]);
  assert.deepEqual((await h.service.targets("collection", pane, false)).map(s => s.itemID), [a.id]);
  assert.deepEqual((await h.service.targets("library", pane)).map(s => s.itemID), [a.id, b.id]);
});

test("batch saves each paper, lists failures, stops on quota, and respects cancellation before saving", async () => {
  let searches = 0;
  const h = host({ getToken: () => "token", request: async method => {
    if (method === "POST") return { status: 200, data: { export: bibtex } };
    if (++searches === 1) return { status: 200, data: { response: { numFound: 1, docs: [record] } } };
    return { status: 429 };
  } });
  const sources = [h.paper("A", { url: "https://arxiv.org/abs/2609.36355" }), h.paper("B", { url: "https://arxiv.org/abs/2609.36355" }), h.paper("C")].map(h.service.itemSource);
  const report = await h.service.batch(sources);
  assert.equal(report.total, 3); assert.equal(report.completed.length, 1); assert.equal(report.failed.length, 1); assert.equal(report.stopped, true);
  assert.equal(searches, 2); assert.equal([...h.items.values()].filter(i => i.type === "note").length, 1);
  let cancelled = false;
  const other = host({ getToken: () => "token", request: async method => {
    if (method === "POST") { cancelled = true; return { status: 200, data: { export: bibtex } }; }
    return { status: 200, data: { response: { numFound: 1, docs: [record] } } };
  } });
  const aborted = await other.service.batch([other.service.itemSource(other.paper("A", { url: "https://arxiv.org/abs/2609.36355" }))], { cancelled: () => cancelled });
  assert.equal(aborted.cancelled, true); assert.equal(aborted.completed.length, 0);
  assert.equal([...other.items.values()].filter(i => i.type === "note").length, 0);
});

test("combined export removes duplicate ADS records", () => {
  const h = host(); assert.equal(h.service.combine([{ bibcode, bibtex }, { bibcode, bibtex }]), bibtex.trim() + "\n");
});
