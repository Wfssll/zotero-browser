/**
 * Decisions for the embedded Gecko browser.
 *
 * The HTTP User-Agent and navigator.userAgent stay on this engine's own
 * Firefox identity. Only the host app's extra product token is removed, so
 * the two values cannot disagree. Challenge documents are not scripted here.
 */
export const zbBrowserEnv = {
  stockUserAgent(userAgent, extraTokens) {
    const original = String(userAgent || "").replace(/\s+/g, " ").trim();
    let value = original;
    for (const token of extraTokens || []) {
      const extra = String(token || "").trim();
      if (extra) value = value.split(" " + extra).join("");
    }
    value = value.replace(/\s+Zotero\/\d[\w.-]*/gi, "");
    value = value.replace(/\s+/g, " ").trim();
    // A result that is no longer a Firefox UA would disagree with the engine.
    if (!/^Mozilla\/5\.0 /.test(value) || !/Gecko\/\d/.test(value) || !/Firefox\/\d/.test(value)) {
      return original;
    }
    return value;
  },

  sameNavigation(requested, actual) {
    if (!requested || !actual) return false;
    if (requested === actual) return true;
    try {
      const a = new URL(requested);
      const b = new URL(actual);
      if (a.origin !== b.origin) return false;
      const path = value => value.pathname.replace(/\/$/, "") || "/";
      return path(a) === path(b) && a.search === b.search;
    } catch (e) {
      return false;
    }
  },

  /**
   * True when this location is not the document the user asked for.
   * about:blank and a different site are the stale frames that paint before
   * the real load. A same-site redirect is that load and must remain visible.
   */
  shouldIgnoreLocation(expected, spec, original) {
    if (!expected) return false;
    const value = String(spec || "");
    if (!value || value === "about:blank" || value.startsWith("about:")) return true;
    if (value === expected || this.sameNavigation(expected, value)) return false;
    const from = String(original || "");
    if (from && (from === expected || this.sameNavigation(expected, from))) return false;
    try {
      if (new URL(value).origin === new URL(expected).origin) return false;
    } catch (e) {}
    return true;
  }
};
