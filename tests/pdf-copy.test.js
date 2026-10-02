"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../bootstrap.js"), "utf8");
function load(names, mocks = {}) {
  const context = vm.createContext(mocks);
  for (const name of names) {
    const start = source.indexOf("function " + name + "(");
    const end = source.indexOf("\n}\n", start) + 2;
    vm.runInContext(source.slice(source.slice(0, start).endsWith("async ") ? start - 6 : start, end), context);
  }
  return context;
}
const attachment = (pdf, file) => ({ isAttachment: () => true, isPDFAttachment: () => pdf, getFilePathAsync: async () => file });

test("copies the exact reader attachment and reports missing local files without selecting a different PDF", async () => {
  const ctx = load(["zbResolveLocalPDF"]);
  assert.equal(await ctx.zbResolveLocalPDF(attachment(true, "/local/current.pdf")), "/local/current.pdf");
  await assert.rejects(ctx.zbResolveLocalPDF(attachment(true, false)), /尚未保存在本地/);
  await assert.rejects(ctx.zbResolveLocalPDF(attachment(false, "/local/snapshot.html")), /没有 PDF/);
  await assert.rejects(ctx.zbResolveLocalPDF(null), /请先打开/);
});

test("a selected paper uses its preferred available local PDF, skipping snapshots and unavailable attachments", async () => {
  const ctx = load(["zbResolveLocalPDF"]);
  const item = { isAttachment: () => false, isRegularItem: () => true, getBestAttachments: async () => [
    attachment(false, "/local/page.html"), attachment(true, false), attachment(true, "/local/paper.pdf"), attachment(true, "/local/supplement.pdf")
  ] };
  assert.equal(await ctx.zbResolveLocalPDF(item), "/local/paper.pdf");
});

test("the system clipboard receives a native file object, and a missing file leaves the clipboard untouched", () => {
  let exists = true, initializedPath, flavor, data, copied;
  const file = { initWithPath: p => { initializedPath = p; }, exists: () => exists, isFile: () => true };
  const transferable = { init() {}, addDataFlavor: f => { flavor = f; }, setTransferData: (f, d) => { assert.equal(f, flavor); data = d; } };
  const clipboard = { setData: (...args) => { copied = args; } };
  const ctx = load(["zbWritePDFClipboard"], { Components: { interfaces: { nsIClipboard: { kGlobalClipboard: 1 } }, classes: {
    "@mozilla.org/file/local;1": { createInstance: () => file },
    "@mozilla.org/widget/transferable;1": { createInstance: () => transferable },
    "@mozilla.org/widget/clipboard;1": { getService: () => clipboard }
  } } });
  ctx.zbWritePDFClipboard("/local/中文 paper.pdf");
  assert.equal(initializedPath, "/local/中文 paper.pdf"); assert.equal(flavor, "application/x-moz-file");
  assert.equal(data, file); assert.deepEqual(copied, [transferable, null, 1]);
  copied = null; exists = false;
  assert.throws(() => ctx.zbWritePDFClipboard("/missing.pdf"), /不存在/); assert.equal(copied, null);
});

test("a copy click captures the current paper before asynchronous lookup and reports success or failure", async () => {
  const copied = [], alerts = [], notices = [];
  let selected = { id: 1 }, resolve;
  const ctx = load(["zbCopyPDFFile"], {
    zbCiteCurrentItem: () => selected,
    zbResolveLocalPDF: item => new Promise(r => { assert.equal(item.id, 1); resolve = r; }),
    zbWritePDFClipboard: p => copied.push(p),
    Zotero: { ProgressWindow: function () { this.changeHeadline = s => notices.push(s); this.addDescription = () => {}; this.show = () => {}; this.startCloseTimer = () => {}; } },
    Services: { prompt: { alert: (...args) => alerts.push(args) } }
  });
  const pending = ctx.zbCopyPDFFile({}); selected = { id: 2 }; resolve("/local/first.pdf"); await pending;
  assert.deepEqual(copied, ["/local/first.pdf"]); assert.deepEqual(notices, ["已复制 PDF 文件"]);
  ctx.zbResolveLocalPDF = async () => { throw new Error("没有本地文件"); };
  await ctx.zbCopyPDFFile({}); assert.equal(alerts[0][2], "没有本地文件"); assert.equal(copied.length, 1);
});

test("opening or switching browser PDFs never opens Cite or queries ADS; navigation only clears the old browser result", () => {
  const browserSource = fs.readFileSync(path.join(__dirname, "../content/sidebar-browser.js"), "utf8");
  const start = browserSource.indexOf("  function updateCiteURL(");
  const end = browserSource.indexOf("\n  }", start) + 4;
  const cleared = [], hidden = [];
  const win = {};
  const ctx = vm.createContext({ doc: { defaultView: win }, zbCitationService: {}, lastCiteURL: "",
    zbCitePopupIsOpen: () => false, zbHideCitePopup: w => hidden.push(w), zbClearBrowserCiteSource: w => cleared.push(w) });
  vm.runInContext(browserSource.slice(start, end), ctx);
  ctx.updateCiteURL("https://arxiv.org/pdf/2609.36355");
  ctx.updateCiteURL("https://arxiv.org/pdf/2609.36355");
  ctx.updateCiteURL("https://example.org/paper.pdf");
  assert.equal(cleared.length, 2); assert.equal(hidden.length, 0);
  ctx.zbCitePopupIsOpen = () => true;
  ctx.updateCiteURL("https://arxiv.org/pdf/2609.36355v2"); assert.deepEqual(hidden, [win]);
});
