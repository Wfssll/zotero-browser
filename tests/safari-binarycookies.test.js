"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const parseSafariBinaryCookies = require("../content/safari-binarycookies.js");

const MAC_EPOCH_TO_UNIX = parseSafariBinaryCookies.CF_EPOCH_TO_UNIX;
const FIXED_NOW = 2_000_000_000;

function nulString(value) {
  return Buffer.from(String(value) + "\0", "utf8");
}

/**
 * Build one standard Safari cookie record. BinaryCookies stores the four
 * string offsets at bytes 16..28, expiry/creation doubles at 40/48, and all
 * record fields are little endian.
 */
function makeRecord({
  url,
  name,
  path = "/",
  value = "",
  flags = 0,
  expiryMacSeconds = 0,
  creationMacSeconds = 0,
  corruptUrlOffset = false
}) {
  const fields = [nulString(url), nulString(name), nulString(path), nulString(value)];
  const offsets = [];
  let cursor = 56;
  for (const field of fields) {
    offsets.push(cursor);
    cursor += field.length;
  }

  const record = Buffer.alloc(cursor);
  record.writeUInt32LE(record.length, 0);
  record.writeUInt32LE(0, 4); // unknown
  record.writeUInt32LE(flags >>> 0, 8);
  record.writeUInt32LE(0, 12); // unknown
  record.writeUInt32LE(corruptUrlOffset ? 0xfffffff0 : offsets[0], 16);
  record.writeUInt32LE(offsets[1], 20);
  record.writeUInt32LE(offsets[2], 24);
  record.writeUInt32LE(offsets[3], 28);
  record.writeBigUInt64LE(0n, 32); // comment/comment URL offsets
  record.writeDoubleLE(expiryMacSeconds, 40);
  record.writeDoubleLE(creationMacSeconds, 48);
  fields.forEach((field, index) => field.copy(record, offsets[index]));
  return record;
}

/** Build one page, including its zero footer and little-endian offset table. */
function makePage(records, offsetOverrides = []) {
  const recordCount = Math.max(records.length, offsetOverrides.length);
  const firstRecordOffset = 12 + (recordCount * 4);
  const offsets = [];
  let cursor = firstRecordOffset;
  for (let index = 0; index < recordCount; index++) {
    if (offsetOverrides[index] !== undefined) {
      offsets.push(offsetOverrides[index]);
    } else {
      offsets.push(cursor);
      cursor += records[index].length;
    }
  }

  const page = Buffer.alloc(cursor);
  page.writeUInt32BE(0x00000100, 0);
  page.writeUInt32LE(recordCount, 4);
  offsets.forEach((offset, index) => page.writeUInt32LE(offset >>> 0, 8 + (index * 4)));
  // The page footer is the four bytes immediately before the first record.
  page.writeUInt32LE(0, 8 + (recordCount * 4));
  let recordOffset = firstRecordOffset;
  for (let index = 0; index < records.length; index++) {
    if (offsetOverrides[index] !== undefined) {
      continue;
    }
    records[index].copy(page, recordOffset);
    recordOffset += records[index].length;
  }
  return page;
}

function makeFile(pages) {
  const header = Buffer.alloc(8 + (pages.length * 4));
  header.write("cook", 0, "ascii");
  header.writeUInt32BE(pages.length, 4);
  pages.forEach((page, index) => header.writeUInt32BE(page.length, 8 + (index * 4)));
  return Buffer.concat([header, ...pages]);
}

function macSeconds(unixSeconds) {
  return unixSeconds - MAC_EPOCH_TO_UNIX;
}

test("parses multiple pages and keeps cookie boundaries, flags, and empty values", () => {
  const session = makeRecord({
    url: "https://example.com",
    name: "sid",
    value: "",
    flags: 0x5,
    expiryMacSeconds: 0
  });
  const persistent = makeRecord({
    url: "https://.example.com/login",
    name: "remember",
    path: "/login",
    value: "yes",
    flags: 0x1,
    expiryMacSeconds: macSeconds(FIXED_NOW + 3600)
  });
  const evil = makeRecord({
    url: "https://evilgoogle.com",
    name: "token",
    value: "do-not-leak",
    expiryMacSeconds: macSeconds(FIXED_NOW + 3600)
  });
  const expired = makeRecord({
    url: "https://example.com",
    name: "old",
    value: "old-value",
    expiryMacSeconds: 1
  });
  const malformed = makeRecord({
    url: "https://example.com",
    name: "bad",
    value: "secret-offset",
    corruptUrlOffset: true
  });

  const firstPage = makePage([session, persistent]);
  const secondPage = makePage(
    [evil, expired, malformed],
    [undefined, undefined, 0xfffffff0]
  );
  const result = parseSafariBinaryCookies(makeFile([firstPage, secondPage]), { now: FIXED_NOW });

  assert.equal(result.stats.pages, 2);
  assert.equal(result.stats.records, 5);
  assert.equal(result.stats.accepted, 3);
  assert.equal(result.stats.expired, 1);
  assert.equal(result.stats.malformed, 1);
  assert.equal(result.stats.session, 1);
  assert.equal(result.cookies.length, 3);

  const parsedSession = result.cookies.find(cookie => cookie.name === "sid");
  assert.deepEqual(parsedSession, {
    domain: "example.com",
    path: "/",
    name: "sid",
    value: "",
    secure: true,
    httpOnly: true,
    session: true,
    expiry: 0,
    hostOnly: true
  });

  const parsedPersistent = result.cookies.find(cookie => cookie.name === "remember");
  assert.equal(parsedPersistent.domain, ".example.com");
  assert.equal(parsedPersistent.hostOnly, false);
  assert.equal(parsedPersistent.path, "/login");
  assert.equal(parsedPersistent.expiry, FIXED_NOW + 3600);
  assert.equal(parsedPersistent.secure, true);

  // A substring match would incorrectly treat evilgoogle.com as google.com.
  const parsedEvil = result.cookies.find(cookie => cookie.name === "token");
  assert.equal(parsedEvil.domain, "evilgoogle.com");
  assert.equal(parsedEvil.hostOnly, true);
  assert.ok(!result.errors.some(error => error.includes("do-not-leak") || error.includes("secret-offset")));
});

test("keeps zero expiry as a session and rejects impossible expiry values", () => {
  const zeroExpiry = makeRecord({
    url: "https://session.example",
    name: "zero",
    value: "v",
    expiryMacSeconds: 0
  });
  const impossibleExpiry = makeRecord({
    url: "https://invalid-expiry.example",
    name: "huge",
    value: "v",
    expiryMacSeconds: Number.MAX_VALUE
  });
  const result = parseSafariBinaryCookies(makeFile([makePage([zeroExpiry, impossibleExpiry])]), {
    now: FIXED_NOW
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.cookies.length, 1);
  assert.equal(result.cookies[0].name, "zero");
  assert.equal(result.cookies[0].session, true);
  assert.equal(result.cookies[0].expiry, 0);
  assert.equal(result.stats.session, 1);
  assert.equal(result.stats.malformed, 1);
});

test("can include an expired record only when explicitly requested", () => {
  const expired = makeRecord({
    url: "https://example.com",
    name: "old",
    value: "v",
    expiryMacSeconds: 1
  });
  const bytes = makeFile([makePage([expired])]);
  const omitted = parseSafariBinaryCookies(bytes, { now: FIXED_NOW });
  assert.equal(omitted.cookies.length, 0);
  assert.equal(omitted.stats.expired, 1);

  const included = parseSafariBinaryCookies(bytes, { now: FIXED_NOW, includeExpired: true });
  assert.equal(included.cookies.length, 1);
  assert.equal(included.cookies[0].session, false);
  assert.equal(included.cookies[0].expiry, MAC_EPOCH_TO_UNIX + 1);
});

test("rejects invalid headers without exposing input data in diagnostics", () => {
  const secret = Buffer.from("nook-not-a-cookie-file-secret-value", "utf8");
  const result = parseSafariBinaryCookies(secret);
  assert.deepEqual(result.cookies, []);
  assert.ok(result.errors.length > 0);
  assert.ok(!result.errors.join(" ").includes("secret-value"));
});

test("fails closed for control characters in domains and offsets before the page footer", () => {
  const controlDomain = makeRecord({
    url: "https://bad\u0001.example",
    name: "control",
    value: "must-not-import"
  });
  const controlResult = parseSafariBinaryCookies(makeFile([makePage([controlDomain])]), {
    now: FIXED_NOW
  });
  assert.equal(controlResult.cookies.length, 0);
  assert.equal(controlResult.stats.malformed, 1);
  assert.ok(!controlResult.errors.join(" ").includes("must-not-import"));

  // An offset that points into the page's offset table/footer is not a
  // record. The parser must reject it without reading arbitrary bytes.
  const forgedOffsetPage = makePage([
    makeRecord({ url: "https://forged.example", name: "forged", value: "value" })
  ], [8]);
  const forgedResult = parseSafariBinaryCookies(makeFile([forgedOffsetPage]), {
    now: FIXED_NOW
  });
  assert.equal(forgedResult.cookies.length, 0);
  assert.equal(forgedResult.stats.records, 1);
  assert.equal(forgedResult.stats.malformed, 1);
});
