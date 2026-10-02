const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zoomContext = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../content/zoom.sys.mjs"), "utf8").replace("export const", "var"), zoomContext);
const actorSource = fs.readFileSync(path.join(__dirname, '../content/actors/ZoteroBrowserEmbedChild.sys.mjs'), 'utf8');
const legacySource = fs.readFileSync(path.join(__dirname, '../content/frame-script.js'), 'utf8');

function actorHarness() {
  const context = { JSWindowActorChild: class {}, URL, Date, zbZoom: zoomContext.zbZoom };
  vm.createContext(context);
  vm.runInContext(actorSource.replace(/^import .*;/m, '').replace('export class', 'class') + '\nthis.Actor = ZoteroBrowserEmbedChild;', context);
  const actor = new context.Actor();
  const messages = [];
  const navigator = {};
  Object.defineProperty(navigator, 'webdriver', { value: true, configurable: false });
  actor.contentWindow = { navigator, location: new URL('https://example.org/paper'), setTimeout() {} };
  actor.document = { title: 'Article', body: { innerText: 'Research article', innerHTML: '' }, querySelector: () => null };
  actor.browsingContext = { top: {} };
  actor.sendAsyncMessage = (name, data) => messages.push({ name, data });
  return { actor, messages };
}
function click(url, extra = {}) {
  const link = { href: url, hasAttribute: () => false, getAttribute: () => '' };
  return Object.assign({ type: 'click', button: 0, target: { closest: () => link },
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }
  }, extra);
}

test('ordinary navigation remains native; PDF and new-tab navigation still use the plugin', () => {
  const { actor, messages } = actorHarness();
  const ordinary = click('https://example.org/next');
  actor.handleEvent(ordinary);
  assert.equal(ordinary.prevented, false);
  assert.equal(messages.length, 0);
  const pdf = click('https://example.org/paper.pdf');
  actor.handleEvent(pdf);
  assert.equal(pdf.prevented, true);
  assert.equal(messages[0].data.pdf, true);
  actor.handleEvent(click('https://example.org/next', { ctrlKey: true }));
  assert.equal(messages[1].data.newTab, true);
});

test('challenge links and widget pages are left to the site without navigator overrides', () => {
  const { actor, messages } = actorHarness();
  actor.document.title = 'Just a moment...';
  const event = click('https://example.org/paper?__cf_chl_tk=example');
  actor.handleEvent(event);
  actor.handleEvent({ type: 'DOMContentLoaded' });
  assert.equal(event.prevented, false);
  assert.equal(messages.length, 0);
  assert.equal(actor.contentWindow.navigator.webdriver, true);
  assert.doesNotMatch(actorSource, /defineProperty|_applyAntiFingerprint/);
});

test('normal forms with a Turnstile script are not reported as failed challenges', () => {
  const { actor } = actorHarness();
  actor.document.body.innerHTML = '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>';
  assert.equal(actor._detectChallengeKind(), false);
});

test('challenge advice is delayed, advisory, and cleared after the challenge ends', () => {
  const { actor, messages } = actorHarness();
  actor.document.title = 'Just a moment...';
  actor._checkChallengePage(1500);
  actor._checkChallengePage(7000);
  assert.equal(messages.length, 0);
  actor._checkChallengePage(15000);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].name, 'Captcha');
  actor.document.title = 'Article';
  actor._checkChallengePage(30000);
  assert.equal(messages[1].data.cleared, true);
});

test('legacy content bridge also preserves native navigation and navigator properties', () => {
  const messages = [];
  const content = { location: new URL('https://example.org/paper'), navigator: { webdriver: true },
    document: { title: 'Article', querySelector: () => null } };
  const context = { content, URL, addEventListener() {}, sendAsyncMessage: (...args) => messages.push(args) };
  vm.createContext(context); vm.runInContext(legacySource, context);
  const ordinary = click('https://example.org/next');
  assert.equal(context.zbHandleWebLink(ordinary), false);
  assert.equal(ordinary.prevented, false);
  content.document.title = 'Just a moment...';
  assert.equal(context.zbHandleWebLink(click('https://example.org/file.pdf')), false);
  assert.equal(messages.length, 0);
  assert.equal(content.navigator.webdriver, true);
});
