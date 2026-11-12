const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const context = vm.createContext({ URL });
vm.runInContext(
  fs.readFileSync(path.join(root, "content/browser-env.sys.mjs"), "utf8").replace("export const", "var"),
  context
);
const env = context.zbBrowserEnv;
const sidebar = fs.readFileSync(path.join(root, "content/sidebar-browser.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "bootstrap.js"), "utf8");
const actor = fs.readFileSync(path.join(root, "content/actors/ZoteroBrowserEmbedChild.sys.mjs"), "utf8");

const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0";

test("stock user agent drops the host product token and keeps the Firefox engine identity", () => {
  assert.equal(env.stockUserAgent(FIREFOX + " Zotero/9.0.6"), FIREFOX);
  assert.equal(env.stockUserAgent(FIREFOX + " Zotero/9.0.6", ["Zotero/9.0.6"]), FIREFOX);
  assert.equal(env.stockUserAgent(FIREFOX + " MyApp/1", ["MyApp/1"]), FIREFOX);
  assert.equal(env.stockUserAgent(FIREFOX), FIREFOX);
  assert.equal(
    env.stockUserAgent("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36"),
    "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36"
  );
  assert.equal(env.stockUserAgent(""), "");
});

test("a foreign history entry is ignored and a same-site redirect is kept", () => {
  const expected = "https://publisher.example/article";
  assert.equal(env.shouldIgnoreLocation("", "https://old.example/", ""), false);
  assert.equal(env.shouldIgnoreLocation(expected, "about:blank", ""), true);
  assert.equal(env.shouldIgnoreLocation(expected, "https://old.example/paper", ""), true);
  assert.equal(env.shouldIgnoreLocation(expected, expected, ""), false);
  assert.equal(env.shouldIgnoreLocation(expected, expected + "/", ""), false);
  assert.equal(env.shouldIgnoreLocation(expected, "https://publisher.example/login", expected), false);
  assert.equal(env.shouldIgnoreLocation(expected, "https://publisher.example/login", ""), false);
  assert.equal(env.sameNavigation(expected, "https://other.example/article"), false);
});

test("navigation does not abort into the previous document or spoof the page", () => {
  const start = sidebar.indexOf("function navigate(targetUrl)");
  const end = sidebar.indexOf("function arxivAbsFromPdf");
  const navigate = sidebar.slice(start, end);
  assert.equal(navigate.includes("browser.stop()"), false);
  assert.match(sidebar, /function loadInBrowser[\s\S]*?LOAD_FLAGS_REPLACE_HISTORY/);
  assert.match(sidebar, /nodefaultsrc/);
  assert.match(sidebar, /customUserAgent/);
  assert.match(sidebar, /docShellIsActive/);
  assert.match(sidebar, /useTrackingProtection/);
  assert.match(bootstrap, /openPluginTab\(inst, aURI, "请稍候…", true\)/);
  assert.match(bootstrap, /openPluginTab\(inst, aURI, aName \|\| "请稍候…", true\)/);
  assert.doesNotMatch(actor, /defineProperty|_applyAntiFingerprint/);
});
