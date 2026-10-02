"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const sidebarSource = fs.readFileSync(
  require("node:path").join(__dirname, "..", "content", "sidebar-browser.js"),
  "utf8"
);

// Evaluate the production helper from sidebar-browser.js instead of copying
// its logic into this test. The helper is nested in the UI builder, so a
// small brace-balanced extractor keeps the test independent of Zotero/DOM
// globals while still exercising the exact source used at runtime.
function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `production helper ${name} must exist`);
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, `production helper ${name} must have a body`);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  assert.fail(`unterminated production helper ${name}`);
}

const normalizeCookieDomain = vm.runInNewContext(
  `(${extractFunction(sidebarSource, "normalizeCookieDomain")})`,
  { URL }
);
const cookieDomainMatches = vm.runInNewContext(
  `(${extractFunction(sidebarSource, "cookieDomainMatches")})`,
  { normalizeCookieDomain }
);

test("production Safari current-domain filter matches labels, not substrings", () => {
  assert.equal(cookieDomainMatches("google.com", "google.com"), true);
  assert.equal(cookieDomainMatches("accounts.google.com", "google.com"), true);
  assert.equal(cookieDomainMatches(".accounts.google.com", ".google.com"), true);
  assert.equal(cookieDomainMatches("evilgoogle.com", "google.com"), false);
  assert.equal(cookieDomainMatches("google.com.evil.example", "google.com"), false);
  assert.equal(cookieDomainMatches("", "google.com"), false);
});
