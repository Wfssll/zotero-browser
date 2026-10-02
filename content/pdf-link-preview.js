/* Geometry-only helpers: never infer a paper URL from neighbouring citations. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZBPDFLinkPreview = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function textRows(items, viewport) {
    const lines = [];
    for (const item of items || []) {
      if (!item.str || !item.str.trim() || !item.transform) continue;
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      const [endX] = viewport.convertToViewportPoint(item.transform[4] + (item.width || 0), item.transform[5]);
      const height = Math.max(1, Math.abs(item.height || item.transform[3] || 10));
      let line = lines.find(row => Math.abs(row.y - y) < 2.5);
      if (!line) { line = { y, parts: [] }; lines.push(line); }
      line.parts.push({ x: Math.min(x, endX), right: Math.max(x, endX), height, text: item.str });
    }
    const rows = [];
    for (const line of lines) {
      line.parts.sort((a, b) => a.x - b.x);
      let row = null;
      for (const part of line.parts) {
        // A shared baseline is not a shared line in a two-column paper.
        if (!row || part.x - row.right > Math.max(18, part.height * 2)) {
          row = { x: part.x, right: part.right, y: line.y, height: part.height, text: part.text };
          rows.push(row);
        } else {
          row.right = Math.max(row.right, part.right);
          row.height = Math.max(row.height, part.height);
          row.text += " " + part.text;
        }
      }
    }
    for (const row of rows) row.text = row.text.replace(/\s+/g, " ").trim();
    return rows.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function referenceRegion(rows, point) {
    if (!point || !point.hasCoordinates || !Number.isFinite(point.y)) return null;
    const hasX = Number.isFinite(point.x);
    let nearby = rows.filter(row => row.y >= point.y - 6 && row.y <= point.y + 24 &&
      (!hasX || (point.x >= row.x - 80 && point.x <= row.right + 8)));
    nearby.sort((a, b) => Math.abs(a.y - point.y) - Math.abs(b.y - point.y));
    const seed = nearby[0];
    if (!seed) return null;
    if (!hasX && nearby.some(row => row !== seed && Math.abs(row.y - seed.y) < 3 &&
        (row.x > seed.right || row.right < seed.x))) return null;
    const sameColumn = rows.filter(row => row.right > seed.x && row.x < seed.right)
      .sort((a, b) => a.y - b.y);
    const index = sameColumn.indexOf(seed);
    const numbered = /^\s*(?:\[\d+\]|\d{1,3}[.)])\s*\S/;
    let start = index;
    while (start > 0 && !numbered.test(sameColumn[start].text) &&
        seed.y - sameColumn[start - 1].y < 120 &&
        sameColumn[start].y - sameColumn[start - 1].y < 24) start--;
    if (!numbered.test(sameColumn[start].text)) {
      // Author/year layouts cannot be reliably segmented by this heuristic.
      // Only the exact destination line can contribute a link in that case.
      return { left: seed.x - 3, right: seed.right + 3,
        top: seed.y - seed.height - 2, bottom: seed.y + 3, snippet: seed.text };
    }
    let end = start;
    while (end + 1 < sameColumn.length && !numbered.test(sameColumn[end + 1].text) &&
        sameColumn[end + 1].y - sameColumn[end].y < 24 &&
        sameColumn[end + 1].y - sameColumn[start].y < 160) end++;
    // A reference boundary before the destination means association failed.
    if (end < index) return null;
    const entry = sameColumn.slice(start, end + 1);
    return {
      left: Math.min(...entry.map(row => row.x)) - 3,
      right: Math.max(...entry.map(row => row.right)) + 3,
      top: entry[0].y - entry[0].height - 2,
      bottom: entry[entry.length - 1].y + 3,
      snippet: entry.map(row => row.text).join(" ").slice(0, 160)
    };
  }

  function linksForReference(annotations, region) {
    if (!region) return [];
    const found = [];
    for (const item of annotations) {
      if (!/^https?:\/\//i.test(item.url || "") || !item.rect) continue;
      const [left, top, right, bottom] = item.rect;
      const x = (left + right) / 2, y = (top + bottom) / 2;
      if (x < region.left || x > region.right || y < region.top || y > region.bottom) continue;
      if (!found.some(link => link.url === item.url)) found.push(item);
    }
    return found;
  }
  return { textRows, referenceRegion, linksForReference };
});
