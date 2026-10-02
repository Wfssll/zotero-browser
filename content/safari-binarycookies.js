/*
 * Safe parser for Apple's Cookies.binarycookies format.
 *
 * This file deliberately has no Zotero/Gecko dependencies.  It can be loaded
 * with Services.scriptloader (where it publishes zbParseSafariBinaryCookies)
 * or required from Node for fixture tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.zbParseSafariBinaryCookies = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HEADER_MAGIC = [0x63, 0x6f, 0x6f, 0x6b]; // "cook"
  const PAGE_MAGIC = 0x00000100;
  const CF_EPOCH_TO_UNIX = 978307200;
  const MAX_PAGES = 100000;
  const MAX_PAGE_SIZE = 64 * 1024 * 1024;
  const MAX_COOKIE_RECORDS_PER_PAGE = 100000;
  const COOKIE_HEADER_SIZE = 56;

  function asBytes(input) {
    // IOUtils and the parser can live in different Gecko globals. instanceof
    // rejects a valid foreign Uint8Array/ArrayBuffer; use native brand checks.
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    try {
      const length = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get.call(input);
      return new Uint8Array(input, 0, length);
    } catch (_) {
      throw new TypeError("binarycookies input must be an ArrayBuffer or Uint8Array");
    }
  }

  function sameMagic(bytes, offset, magic) {
    if (offset < 0 || offset + magic.length > bytes.length) {
      return false;
    }
    for (let i = 0; i < magic.length; i++) {
      if (bytes[offset + i] !== magic[i]) {
        return false;
      }
    }
    return true;
  }

  function u32BE(view, offset) {
    return view.getUint32(offset, false);
  }

  function readU32(view, offset, littleEndian) {
    return view.getUint32(offset, !!littleEndian);
  }

  function safeCString(bytes, offset, end) {
    if (!Number.isInteger(offset) || offset < 0 || offset >= end || offset >= bytes.length) {
      return null;
    }
    let stop = offset;
    while (stop < end && stop < bytes.length && bytes[stop] !== 0) {
      stop++;
    }
    if (stop >= end || stop > bytes.length) {
      return null;
    }
    // TextDecoder is available in Firefox and current Node.  Keep a tiny
    // fallback for old Gecko test harnesses where it is not exposed.
    try {
      if (typeof TextDecoder === "function") {
        return new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(offset, stop));
      }
    } catch (e) {}
    let result = "";
    for (let i = offset; i < stop; i++) {
      result += String.fromCharCode(bytes[i]);
    }
    return result;
  }

  function normaliseDomain(rawUrl) {
    let raw = String(rawUrl || "").trim();
    if (!raw) {
      return null;
    }
    // Safari normally stores a URL (rather than a separate domain field).
    // Preserve a leading dot when a fixture or older build includes one.
    let host = raw;
    let scheme = raw.match(/^[a-z][a-z0-9+.-]*:\/\//i);
    if (scheme) {
      host = raw.slice(scheme[0].length);
    }
    host = host.split(/[/?#]/, 1)[0].trim();
    if (host.includes("@")) {
      host = host.slice(host.lastIndexOf("@") + 1);
    }
    // Strip a port, except for bracketed IPv6 literals.
    if (host[0] === "[") {
      let close = host.indexOf("]");
      if (close > 0) {
        host = host.slice(0, close + 1);
      }
    } else {
      host = host.replace(/:\d+$/, "");
    }
    if (!host || host === "." || /[\u0000-\u001f\u007f]/.test(host) || /\s/.test(host)) {
      return null;
    }
    return host;
  }

  function toUnixExpiry(cfSeconds) {
    if (!Number.isFinite(cfSeconds)) {
      return { expiry: 0, invalid: true };
    }
    // Safari's binary file does not expose a portable sessionOnly field.  A
    // zero expiry is treated as a session cookie as the least surprising
    // import behavior; the UI explains that session-only state may be absent.
    if (cfSeconds === 0) {
      return { expiry: 0, invalid: false };
    }
    if (cfSeconds < 0) {
      return { expiry: 0, invalid: true };
    }
    let unix = Math.floor(cfSeconds + CF_EPOCH_TO_UNIX);
    // Reject impossible values before they reach Services.cookies.add.
    if (!Number.isFinite(unix) || unix <= 0 || unix > 4102444800) {
      return { expiry: 0, invalid: true };
    }
    return { expiry: unix, invalid: false };
  }

  function parse(input, options) {
    let bytes = asBytes(input);
    let now = options && Number.isFinite(Number(options.now))
      ? Math.floor(Number(options.now))
      : Math.floor(Date.now() / 1000);
    let includeExpired = !!(options && options.includeExpired);
    let stats = {
      pages: 0,
      records: 0,
      accepted: 0,
      expired: 0,
      malformed: 0,
      session: 0
    };
    let errors = [];
    let cookies = [];
    if (bytes.length < 8 || !sameMagic(bytes, 0, HEADER_MAGIC)) {
      return { cookies, stats, errors: ["invalid binarycookies header"] };
    }

    let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pageCount = u32BE(view, 4);
    // Header integers are big endian in Apple's format.
    if (!pageCount || pageCount > MAX_PAGES) {
      return { cookies, stats, errors: ["invalid binarycookies page count"] };
    }
    let tableEnd = 8 + pageCount * 4;
    if (tableEnd > bytes.length) {
      return { cookies, stats, errors: ["truncated binarycookies page table"] };
    }

    let pageOffset = tableEnd;
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      let pageSize = u32BE(view, 8 + pageIndex * 4);
      if (!pageSize || pageSize > MAX_PAGE_SIZE || pageOffset + pageSize > bytes.length) {
        stats.malformed++;
        errors.push("page " + pageIndex + " exceeds file bounds");
        break;
      }
      stats.pages++;
      let pageEnd = pageOffset + pageSize;
      if (pageSize < 8) {
        stats.malformed++;
        errors.push("page " + pageIndex + " is too small");
        pageOffset = pageEnd;
        continue;
      }

      let pageMagic = u32BE(view, pageOffset);
      if (pageMagic !== PAGE_MAGIC) {
        stats.malformed++;
        errors.push("page " + pageIndex + " has an unknown magic");
        pageOffset = pageEnd;
        continue;
      }

      // Page cookie counts and offsets, and all cookie fields, are LE.  The
      // page magic and file page table are the only BE integers in the file.
      let littleEndian = true;
      let recordCount = readU32(view, pageOffset + 4, littleEndian);
      let recordsTableEnd = pageOffset + 8 + recordCount * 4;
      if (recordCount > MAX_COOKIE_RECORDS_PER_PAGE || recordsTableEnd + 4 > pageEnd) {
        stats.malformed++;
        errors.push("page " + pageIndex + " has an invalid cookie count");
        pageOffset = pageEnd;
        continue;
      }
      if (readU32(view, recordsTableEnd, true) !== 0) {
        stats.malformed++;
        errors.push("page " + pageIndex + " has an invalid table footer");
        pageOffset = pageEnd;
        continue;
      }

      for (let recordIndex = 0; recordIndex < recordCount; recordIndex++) {
        let offsetCell = pageOffset + 8 + recordIndex * 4;
        let recordOffset = readU32(view, offsetCell, littleEndian);
        let absolute = pageOffset + recordOffset;
        stats.records++;
        let minimumRecordOffset = 8 + recordCount * 4 + 4;
        if (recordOffset < minimumRecordOffset || absolute < pageOffset || absolute + COOKIE_HEADER_SIZE > pageEnd) {
          stats.malformed++;
          continue;
        }
        let recordSize = readU32(view, absolute, littleEndian);
        if (recordSize < COOKIE_HEADER_SIZE || recordSize > pageEnd - absolute) {
          stats.malformed++;
          continue;
        }
        let recordEnd = absolute + recordSize;
        let flags = readU32(view, absolute + 8, littleEndian);
        let offsets = [16, 20, 24, 28]
          .map(field => readU32(view, absolute + field, littleEndian));
        if (offsets.some(offset => offset < COOKIE_HEADER_SIZE || offset >= recordSize)) {
          stats.malformed++;
          continue;
        }
        let values = offsets.map(offset => safeCString(bytes, absolute + offset, recordEnd));
        if (values.some(value => value === null)) {
          stats.malformed++;
          continue;
        }
        let url = values[0];
        let name = values[1];
        let path = values[2];
        let value = values[3];
        let domain = normaliseDomain(url);
        if (domain === null || !name) {
          stats.malformed++;
          continue;
        }
        if (!path.startsWith("/")) {
          path = "/" + path;
        }
        let expiryDouble;
        try {
          expiryDouble = view.getFloat64(absolute + 40, true);
        } catch (e) {
          expiryDouble = NaN;
        }
        let expiryResult = toUnixExpiry(expiryDouble);
        if (expiryResult.invalid) {
          stats.malformed++;
          continue;
        }
        let expiry = expiryResult.expiry;
        if (expiry && expiry <= now) {
          stats.expired++;
          if (!includeExpired) {
            continue;
          }
        }
        let hostOnly = domain[0] !== ".";
        let session = !expiry;
        if (session) {
          stats.session++;
        }
        cookies.push({
          domain,
          path,
          name,
          value,
          secure: !!(flags & 0x1),
          httpOnly: !!(flags & 0x4),
          session,
          expiry,
          hostOnly,
          // Safari binarycookies does not carry a portable SameSite field.
        });
        stats.accepted++;
      }
      pageOffset = pageEnd;
    }
    return { cookies, stats, errors };
  }

  // Expose constants for fixture authors without making them part of the
  // parser's cookie output.
  parse.CF_EPOCH_TO_UNIX = CF_EPOCH_TO_UNIX;
  parse.format = "Cookies.binarycookies";
  return parse;
});
