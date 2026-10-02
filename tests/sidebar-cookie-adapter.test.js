"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sidebarSource = fs.readFileSync(
  path.join(__dirname, "..", "content", "sidebar-browser.js"),
  "utf8"
);

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `production helper ${name} must exist`);
  const open = source.indexOf("{", start);
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

function loadAdapter() {
  const Ci = {
    nsICookie: {
      SCHEME_HTTP: 1,
      SCHEME_HTTPS: 2,
      SAMESITE_NONE: 0,
      SAMESITE_LAX: 1,
      SAMESITE_STRICT: 2,
      SAMESITE_UNSET: -1
    },
    nsICookieValidation: { eOK: 0 }
  };
  const calls = [];
  const Services = {
    cookies: {
      add(...args) {
        calls.push(args);
        return { result: Ci.nsICookieValidation.eOK };
      }
    }
  };
  const chromeExpiryToUnix = new Function(
    `return (${extractFunction(sidebarSource, "chromeExpiryToUnix")});`
  )();
  const cookieSameSite = new Function(
    "Ci",
    `return (${extractFunction(sidebarSource, "cookieSameSite")});`
  )(Ci);
  const addCookieRecord = new Function(
    "chromeExpiryToUnix",
    "cookieSameSite",
    "Ci",
    "Services",
    `return (${extractFunction(sidebarSource, "addCookieRecord")});`
  )(chromeExpiryToUnix, cookieSameSite, Ci, Services);
  return { addCookieRecord, calls };
}

test("production cookie adapter preserves Safari session and host attributes", () => {
  const { addCookieRecord, calls } = loadAdapter();
  const session = {
    domain: "example.com",
    path: "/",
    name: "sid",
    secure: true,
    httpOnly: true,
    session: true,
    expiry: 0
  };
  assert.equal(addCookieRecord(session, "", false), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 8), [
    "example.com", "/", "sid", "", true, true, true, 0
  ]);
});

test("production cookie adapter writes persistent Safari expiry and skips expired rows", () => {
  const { addCookieRecord, calls } = loadAdapter();
  const future = Math.floor(Date.now() / 1000) + 3600;
  const persistent = {
    domain: ".example.com",
    path: "/account",
    name: "remember",
    secure: false,
    httpOnly: false,
    session: false,
    expiry: future
  };
  assert.equal(addCookieRecord(persistent, "yes", false), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 8), [
    ".example.com", "/account", "remember", "yes", false, false, false, future
  ]);

  const expired = { ...persistent, name: "old", expiry: Math.floor(Date.now() / 1000) - 1 };
  assert.equal(addCookieRecord(expired, "old-value", false), false);
  assert.equal(calls.length, 1, "expired records must not reach Services.cookies.add");
});
