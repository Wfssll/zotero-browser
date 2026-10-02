const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const geometry = require('../content/pdf-link-preview.js');
const source = fs.readFileSync(path.join(__dirname, '../content/pdf-viewer.js'), 'utf8');
function fn(name) {
  const re = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
  const start = source.search(re);
  assert.notEqual(start, -1);
  const rest = source.slice(start);
  const end = rest.search(/\n(?:async )?function /);
  return rest.slice(0, end < 0 ? undefined : end);
}
const row = (x, y, text) => ({ x, y, right: x + 190, height: 10, text });
const annotation = (url, x, y) => ({ url, rect: [x, y - 8, x + 80, y + 1] });

test('reference links stay in the targeted entry and column', () => {
  const rows = [row(50, 100, '[1] First paper'), row(330, 100, '[8] Other column'),
    row(50, 113, 'doi link'), row(330, 113, 'unrelated doi'), row(50, 132, '[2] Next paper')];
  const region = geometry.referenceRegion(rows, { x: 50, y: 90, hasCoordinates: true });
  const hits = geometry.linksForReference([
    annotation('https://doi.org/first', 60, 113), annotation('https://doi.org/eighth', 340, 113),
    annotation('https://doi.org/second', 60, 132)
  ], region);
  assert.deepEqual(hits.map(h => h.url), ['https://doi.org/first']);
  assert.match(region.snippet, /First paper/);
  assert.doesNotMatch(region.snippet, /Other|Next/);
});

test('ambiguous page-wide or coordinate-free destinations do not guess a paper', () => {
  const rows = [row(50, 100, '[1] Left'), row(330, 100, '[8] Right')];
  assert.equal(geometry.referenceRegion(rows, { x: null, y: 90, hasCoordinates: true }), null);
  assert.equal(geometry.referenceRegion(rows, { x: 50, y: 90, hasCoordinates: false }), null);
  assert.deepEqual(geometry.linksForReference([annotation('https://doi.org/x', 60, 100)], null), []);
});

test('text rows do not merge opposite columns sharing a baseline', () => {
  const item = (x, str) => ({ str, width: 100, height: 10, transform: [10, 0, 0, 10, x, 100] });
  const rows = geometry.textRows([item(50, '[1] left'), item(330, '[8] right')], {
    convertToViewportPoint: (x, y) => [x, y]
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, '[1] left');
  assert.equal(rows[1].x, 330);
});

test('destination page index zero and horizontal coordinates are preserved', async () => {
  const context = {
    destPointCache: new Map(), pdfDoc: { async getPage(n) {
      assert.equal(n, 1);
      return { getViewport: () => ({ height: 800, convertToViewportPoint: (x, y) => [x, 800 - y] }) };
    } }
  };
  vm.createContext(context); vm.runInContext(fn('resolveDestPoint'), context);
  const point = await context.resolveDestPoint([0, { name: 'XYZ' }, 330, 710]);
  assert.equal(point.pageNumber, 1);
  assert.equal(point.x, 330);
  assert.equal(point.y, 90);
  assert.equal(point.hasCoordinates, true);
});

test('moving to another link immediately invalidates in-flight preview work', () => {
  const timers = new Map(); let id = 0; let cancelled = 0;
  const shown = [];
  const context = {
    previewToken: 1, previewShowTimer: 0, previewHideTimer: 0,
    previewRenderTask: { cancel() { cancelled++; } }, previewEl: { style: {} },
    clearTimeout: key => timers.delete(key), setTimeout: callback => { timers.set(++id, callback); return id; },
    showLinkPreview: (...args) => shown.push(args)
  };
  vm.createContext(context);
  for (const name of ['hideLinkPreview', 'scheduleHideLinkPreview', 'scheduleLinkPreview']) vm.runInContext(fn(name), context);
  context.scheduleLinkPreview('B', { url: 'https://example.org/B' });
  assert.equal(context.previewToken, 2);
  assert.equal(cancelled, 1);
  assert.equal(context.previewEl.style.display, 'none');
  context.scheduleLinkPreview('C', { url: 'https://example.org/C' });
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(shown[0][0], 'C');
  assert.equal(shown[0][2], 3);
});

test('an old page lookup cannot start rendering after the hover target changes', async () => {
  let resolvePage; let renders = 0;
  const context = {
    previewToken: 1, previewCanvas: { style: {} }, previewHeaderEl: { appendChild() {} }, previewListEl: {},
    pdfDoc: { getPage: () => new Promise(resolve => { resolvePage = resolve; }) },
    document: { contains: () => true, createElement: () => ({ addEventListener() {} }) },
    ensurePreviewEl() {}, resolveDestPoint: async () => ({ pageNumber: 1, x: 50, y: 90 }),
    window: { devicePixelRatio: 1 }
  };
  vm.createContext(context); vm.runInContext(fn('showLinkPreview'), context);
  const pending = context.showLinkPreview({}, { dest: 'reference' }, 1);
  await new Promise(setImmediate);
  context.previewToken = 2;
  resolvePage({ render() { renders++; } });
  await pending;
  assert.equal(renders, 0);
});
