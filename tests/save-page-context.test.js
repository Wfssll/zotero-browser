const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../content/sidebar-browser.js'), 'utf8');
const start = source.indexOf('  async function saveCurrentPageToZotero(');
const end = source.indexOf('\n  let toastBox', start);
const code = source.slice(start, end);

test('saving keeps the original URL/title if another tab becomes active during the destination picker', async () => {
  let browser = { contentTitle: 'Original paper' };
  let url = 'https://example.org/original';
  const fields = {}, saved = [];
  const ctx = vm.createContext({
    get browser() { return browser; }, getCleanCurrentUrl: () => url,
    getPaneSelectionInfo: () => ({ libraryID: 1, selectedCol: null }),
    chooseSaveLocation: async () => { browser = { contentTitle: 'Other paper' }; url = 'https://example.org/other'; return { libraryID: 2, collection: { id: 7, name: 'Chosen collection' } }; },
    showToast() {}, dump() {}, zbIsPdfUrl: () => false, getLibraryName: () => 'Library',
    Zotero: { Item: class { setField(k,v) { fields[k] = v; } addToCollection(id) { this.collection = id; } async saveTx() { saved.push(this); return 1; } } }
  });
  vm.runInContext(code, ctx);
  await ctx.saveCurrentPageToZotero();
  assert.equal(fields.title, 'Original paper');
  assert.equal(fields.url, 'https://example.org/original');
  assert.equal(saved[0].libraryID, 2);
  assert.equal(saved[0].collection, 7);
});
