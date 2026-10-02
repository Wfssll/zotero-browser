/**
 * Lightweight PDF renderer using Zotero's bundled pdf.js.
 * Must run as a content document so Map.prototype is extensible.
 */
try {
  if (typeof Map.prototype.getOrInsertComputed !== "function") {
    Map.prototype.getOrInsertComputed = function (key, callbackFn) {
      if (!this.has(key)) {
        this.set(key, callbackFn(key));
      }
      return this.get(key);
    };
  }
} catch (e) {}

const PDFJS_ROOT = "resource://zotero-browser/content/pdfjs/";
const PDFJS_MODULE = PDFJS_ROOT + "build/pdf.mjs";
const PDFJS_WORKER = PDFJS_ROOT + "build/pdf.worker.mjs";
const CMAP_URL = PDFJS_ROOT + "web/cmaps/";
const FONT_URL = PDFJS_ROOT + "web/standard_fonts/";

const pagesEl = document.getElementById("pages");
const errorEl = document.getElementById("error");
const statusEl = document.getElementById("status");
const pageInputEl = document.getElementById("page-input");
const pageTotalEl = document.getElementById("page-total");
const zoomLabelEl = document.getElementById("zoom-label");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const btnZoomIn = document.getElementById("btn-zoom-in");
const btnZoomOut = document.getElementById("btn-zoom-out");
const btnFit = document.getElementById("btn-fit");

let pdfjsLib = null;
let pdfDoc = null;
let currentPage = 1;
let zoom = 1;
let fitWidth = true;
let renderToken = 0;
let pageWraps = [];
let observer = null;
// laidOutZoom 记录上一次真实渲染所用的缩放比；滚轮缩放先按比例拉伸已有
// 位图（GPU 合成，瞬时丝滑），停顿后再按目标缩放清晰重渲。
let laidOutZoom = 1;
// 划词逐字命中用的文本度量上下文
let zbMeasureCtx = null;

function setStatus(text) {
  statusEl.textContent = text || "";
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.add("visible");
  pagesEl.style.display = "none";
}

function hideError() {
  errorEl.classList.remove("visible");
  pagesEl.style.display = "block";
}

async function loadPdfjs() {
  if (pdfjsLib && pdfjsLib.getDocument) {
    return pdfjsLib;
  }
  let lastErr;
  try {
    pdfjsLib = await import(PDFJS_MODULE);
    if (pdfjsLib && pdfjsLib.getDocument) {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      } catch (e) {}
      return pdfjsLib;
    }
  } catch (e) {
    lastErr = e;
  }
  try {
    if (typeof ChromeUtils !== "undefined" && ChromeUtils.importESModule) {
      pdfjsLib = ChromeUtils.importESModule(PDFJS_MODULE);
      if (pdfjsLib && pdfjsLib.getDocument) {
        try {
          pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        } catch (e) {}
        return pdfjsLib;
      }
    }
  } catch (e) {
    lastErr = e;
  }
  throw new Error("无法加载 pdf.js" + (lastErr && lastErr.message ? "：" + lastErr.message : ""));
}

function destroyDoc() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  destPointCache.clear();
  pageAnnosCache.clear();
  pageTextRowsCache.clear();
  hideLinkPreview();
  pageWraps = [];
  pagesEl.innerHTML = "";
  if (pdfDoc) {
    try {
      pdfDoc.destroy();
    } catch (e) {}
    pdfDoc = null;
  }
}

function updatePager() {
  let total = pdfDoc ? pdfDoc.numPages : 0;
  // 输入框聚焦时不打断用户输入；失焦/翻页时才同步当前页码。
  if (document.activeElement !== pageInputEl) {
    pageInputEl.value = total ? String(currentPage) : "–";
  }
  pageTotalEl.textContent = total ? "/ " + total : "/ –";
  zoomLabelEl.textContent = Math.round(zoom * 100) + "%";
  btnPrev.disabled = currentPage <= 1;
  btnNext.disabled = !total || currentPage >= total;
}

pageInputEl.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") {
    e.preventDefault();
    let total = pdfDoc ? pdfDoc.numPages : 0;
    let n = parseInt(pageInputEl.value, 10);
    if (total && isFinite(n)) {
      currentPage = Math.max(1, Math.min(total, n));
      updatePager();
      scrollToPage(currentPage);
    } else {
      updatePager();
    }
    pageInputEl.blur();
  } else if (e.key === "Escape") {
    updatePager();
    pageInputEl.blur();
  }
});
pageInputEl.addEventListener("blur", () => updatePager());

function scrollToPage(num) {
  let wrap = pageWraps[num - 1];
  if (wrap) {
    wrap.scrollIntoView({ block: "start" });
  }
}

let lastLayoutWidth = 0;

function getAvailableWidth() {
  let w = pagesEl.clientWidth;
  if (!w || w < 100) {
    w = document.documentElement.clientWidth || window.innerWidth || 0;
  }
  return Math.max(120, w - 24);
}

function pageScale(baseWidth) {
  if (fitWidth) {
    let available = getAvailableWidth();
    return available / baseWidth;
  }
  return zoom;
}

async function renderWrap(wrap, token) {
  if (!pdfDoc || !wrap || token !== renderToken) {
    return;
  }
  // "rendering" lock prevents concurrent page.render() calls on the same
  // canvas (observer + idle prefetch can both fire for the same page).
  // Without it, one call resets canvas.width mid-render of the other,
  // wiping the bitmap to opaque black (alpha:false) and leaving a black page.
  if (wrap.dataset.rendered === "1" || wrap.dataset.rendering === "1") {
    return;
  }
  wrap.dataset.rendering = "1";
  wrap.dataset.rendered = "pending";
  let pageNum = Number(wrap.dataset.page);
  try {
    let page = await pdfDoc.getPage(pageNum);
    if (token !== renderToken || !wrap.isConnected) {
      wrap.dataset.rendered = "0";
      return;
    }

    // Natural high-resolution rendering (2.0x - 2.5x native resolution without artificial contrast filters)
    let screenDpr = window.devicePixelRatio || 1;
    let dpr = Math.max(2.0, Math.min(screenDpr * 1.25, 2.5));

    let viewport = page.getViewport({ scale: zoom * dpr });
    let canvas = wrap.querySelector("canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      wrap.innerHTML = "";
      wrap.appendChild(canvas);
    }
    let pixelWidth = Math.floor(viewport.width);
    let pixelHeight = Math.floor(viewport.height);
    if (canvas.width !== pixelWidth) {
      canvas.width = pixelWidth;
    }
    if (canvas.height !== pixelHeight) {
      canvas.height = pixelHeight;
    }
    canvas.style.width = Math.floor(viewport.width / dpr) + "px";
    canvas.style.height = Math.floor(viewport.height / dpr) + "px";
    wrap.style.width = canvas.style.width;
    wrap.style.height = canvas.style.height;
    let ctx = canvas.getContext("2d", { alpha: false });
    // alpha:false canvases start opaque black; paint white first so a page
    // can never flash/stay black even if rendering is interrupted later.
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    await page.render({
      canvasContext: ctx,
      viewport: viewport,
      background: "#ffffff"
    }).promise;
    if (token === renderToken && wrap.isConnected) {
      wrap.dataset.rendered = "1";
    } else {
      wrap.dataset.rendered = "0";
      return;
    }

    // Text layer (selection/copy) + link layer (clickable annotations),
    // overlaid on the canvas in CSS-pixel coordinates.
    try {
      await buildTextLayer(page, wrap, zoom);
    } catch (e) {
      pdfDebug("textLayer失败: " + (e && e.message ? e.message : e));
    }
    try {
      if (token === renderToken && wrap.isConnected) {
        await buildLinkLayer(page, wrap, zoom);
      }
    } catch (e) {
      pdfDebug("linkLayer失败: " + (e && e.message ? e.message : e));
    }
  } catch (e) {
    // RenderingCancelledException / same-canvas conflicts: mark unrendered so
    // the IntersectionObserver retries on the next intersection instead of
    // leaving a black page behind.
    wrap.dataset.rendered = "0";
  } finally {
    wrap.dataset.rendering = "0";
  }
}

async function layoutPages(token) {
  if (!pdfDoc) {
    return;
  }
  let first = await pdfDoc.getPage(1);
  if (token !== renderToken) {
    return;
  }
  let base = first.getViewport({ scale: 1 });
  let avail = getAvailableWidth();
  lastLayoutWidth = avail;
  if (fitWidth) {
    zoom = avail / base.width;
  }
  laidOutZoom = zoom;
  updatePager();

  if (observer) {
    observer.disconnect();
  }
  pagesEl.innerHTML = "";
  pageWraps = [];

  observer = new IntersectionObserver((entries) => {
    for (let entry of entries) {
      if (entry.isIntersecting) {
        renderWrap(entry.target, renderToken);
      }
    }
  }, { root: pagesEl, rootMargin: "360px 0px" });

  let cssWidth = Math.floor(base.width * zoom);
  let cssHeight = Math.floor(base.height * zoom);

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    if (token !== renderToken) {
      return;
    }
    let wrap = document.createElement("div");
    wrap.className = "page-wrap";
    wrap.dataset.page = String(i);
    wrap.dataset.rendered = "0";
    wrap.style.width = cssWidth + "px";
    wrap.style.height = cssHeight + "px";
    // 基准尺寸（zoom=1 时的 CSS 像素），滚轮缩放拉伸预览按它做绝对定位，
    // 避免在已拉伸的尺寸上重复乘比例导致页面先暴涨再缩回。
    wrap.__zbCssW = base.width;
    wrap.__zbCssH = base.height;
    pagesEl.appendChild(wrap);
    pageWraps.push(wrap);
    observer.observe(wrap);
  }

  await renderWrap(pageWraps[0], token);
  setStatus("");
  updatePager();
  if (pageWraps[1]) {
    let renderNext = () => {
      if (token === renderToken) {
        renderWrap(pageWraps[1], token);
      }
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(renderNext, { timeout: 350 });
    } else {
      setTimeout(renderNext, 120);
    }
  }
}

function simulateFitWidth() {
  try {
    if (btnFit) {
      btnFit.click();
    }
  } catch (e) {}
}

// 滚轮缩放过程中，先把已渲染的页面按目标缩放绝对拉伸（canvas 位图由
// GPU 缩放、文字/链接层用 transform scale），无需等待重渲即可看到结果，
// 手势停止后再由 layoutPages 按目标缩放重新清晰渲染。
// 所有尺寸都从基准尺寸（zoom=1）绝对算出，可幂等重复调用——不会在已
// 拉伸的尺寸上重复乘比例（那会导致页面先暴涨再缩回）。
function previewZoomStretch() {
  if (!laidOutZoom || !isFinite(laidOutZoom)) {
    return;
  }
  let ratio = zoom / laidOutZoom; // 图层变换系数（绝对值）
  for (let wrap of pageWraps) {
    if (!wrap || !wrap.__zbCssW) {
      continue;
    }
    wrap.style.width = Math.floor(wrap.__zbCssW * zoom) + "px";
    wrap.style.height = Math.floor(wrap.__zbCssH * zoom) + "px";
    let canvas = wrap.querySelector("canvas");
    if (canvas) {
      canvas.style.width = Math.floor(wrap.__zbCssW * zoom) + "px";
      canvas.style.height = Math.floor(wrap.__zbCssH * zoom) + "px";
    }
    let layers = wrap.querySelectorAll(".textLayer, .linkLayer");
    for (let layer of layers) {
      layer.style.transformOrigin = "0 0";
      layer.style.transform = ratio === 1 ? "" : "scale(" + ratio.toFixed(4) + ")";
    }
  }
}

// 缩放状态记忆：localStorage（同源即时恢复）+ 事件上报给插件外壳
// （写入 Zotero 偏好，跨进程可靠）。
let zoomPersistTimer = 0;
function persistZoomState() {
  let state = { zoom: Math.round(zoom * 1000) / 1000, fitWidth: !!fitWidth };
  try {
    window.localStorage.setItem("zb-pdf-zoomstate", JSON.stringify(state));
  } catch (e) {}
  try {
    emit({ type: "zb-pdf-zoomstate", zoom: state.zoom, fitWidth: state.fitWidth });
  } catch (e) {}
}
function scheduleZoomPersist() {
  clearTimeout(zoomPersistTimer);
  zoomPersistTimer = setTimeout(persistZoomState, 400);
}

// 读取上次保存的缩放状态：优先 URL 查询参数（插件外壳从 Zotero 偏好写入），
// 其次 localStorage。返回 { fitWidth:true } 或 { fitWidth:false, zoom } 或 null。
function readSavedZoomState() {
  try {
    let p = new URL(window.location.href).searchParams;
    let fit = p.get("fit");
    let z = parseFloat(p.get("z") || "");
    if (fit === "1") {
      return { fitWidth: true };
    }
    if (fit === "0" && isFinite(z) && z >= 0.3 && z <= 4) {
      return { fitWidth: false, zoom: z };
    }
  } catch (e) {}
  try {
    let raw = window.localStorage.getItem("zb-pdf-zoomstate");
    if (raw) {
      let s = JSON.parse(raw);
      if (s && s.fitWidth) {
        return { fitWidth: true };
      }
      if (s && isFinite(s.zoom) && s.zoom >= 0.3 && s.zoom <= 4) {
        return { fitWidth: false, zoom: s.zoom };
      }
    }
  } catch (e) {}
  return null;
}

async function getDocumentWithFallback(lib, data) {
  let options = {
    data,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: FONT_URL,
    isEvalSupported: false,
    disableStream: true
  };
  try {
    return await lib.getDocument(options).promise;
  } catch (err) {
    options.disableWorker = true;
    return await lib.getDocument(options).promise;
  }
}

async function getDocumentFromUrl(lib, url) {
  let options = {
    url,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: FONT_URL,
    isEvalSupported: false,
    disableStream: true,
    disableAutoFetch: true,
    rangeChunkSize: 262144,
    enableHWA: true,
    withCredentials: false
  };
  try {
    return await lib.getDocument(options).promise;
  } catch (err) {
    let fallback = {
      ...options,
      disableStream: false,
      disableAutoFetch: false,
      disableWorker: true
    };
    return await lib.getDocument(fallback).promise;
  }
}

async function openPdfUrl(url) {
  hideError();
  destroyDoc();
  currentPage = 1;
  fitWidth = true;
  setStatus("正在在线读取 PDF…");
  try {
    if (!/^https?:\/\//i.test(url || "")) {
      throw new Error("PDF 地址无效");
    }
    let saved = readSavedZoomState();
    if (saved && !saved.fitWidth) {
      fitWidth = false;
      zoom = saved.zoom;
    }
    let lib = await loadPdfjs();
    pdfDoc = await getDocumentFromUrl(lib, url);
    setStatus(`共 ${pdfDoc.numPages} 页`);
    renderToken += 1;
    await layoutPages(renderToken);
    document.title = url;

    if (!saved || saved.fitWidth) {
      // 记忆为「适应宽度」或无记忆时，保持原有的自动适应宽度行为。
      setTimeout(simulateFitWidth, 50);
      setTimeout(simulateFitWidth, 180);
    }
  } catch (err) {
    showError("无法在线打开这份 PDF：" + (err && err.message ? err.message : String(err)));
    setStatus("打开失败");
  }
}

async function openPdf({ buffer, url }) {
  hideError();
  destroyDoc();
  currentPage = 1;
  fitWidth = true;
  setStatus("正在解析 PDF…");
  try {
    let lib = await loadPdfjs();
    let raw = buffer;
    if (raw && raw.buffer && typeof raw.byteLength === "number" && raw.BYTES_PER_ELEMENT) {
      raw = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    }
    let n = raw && raw.byteLength ? raw.byteLength : 0;
    if (!n) {
      throw new Error("PDF 数据为空");
    }
    let data = new Uint8Array(n);
    let view = new Uint8Array(raw);
    for (let i = 0; i < n; i++) {
      data[i] = view[i];
    }
    let saved = readSavedZoomState();
    if (saved && !saved.fitWidth) {
      fitWidth = false;
      zoom = saved.zoom;
    }
    pdfDoc = await getDocumentWithFallback(lib, data);
    setStatus(`共 ${pdfDoc.numPages} 页`);
    renderToken += 1;
    await layoutPages(renderToken);
    if (url) {
      document.title = url;
    }

    if (!saved || saved.fitWidth) {
      // 记忆为「适应宽度」或无记忆时，保持原有的自动适应宽度行为。
      setTimeout(simulateFitWidth, 50);
      setTimeout(simulateFitWidth, 180);
    }
  } catch (err) {
    showError("无法打开这份 PDF：" + (err && err.message ? err.message : String(err)));
    setStatus("打开失败");
    try {
      emit({ type: "zb-pdf-error", message: String(err) });
    } catch (e) {}
  }
}

btnPrev.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage -= 1;
    updatePager();
    scrollToPage(currentPage);
  }
});
btnNext.addEventListener("click", () => {
  if (pdfDoc && currentPage < pdfDoc.numPages) {
    currentPage += 1;
    updatePager();
    scrollToPage(currentPage);
  }
});
function zbZoomPdfPage(command) {
  if (!pdfDoc || !["in", "out", "reset"].includes(command)) return null;
  fitWidth = false;
  zoom = command === "reset" ? 1 : Math.max(.5, Math.min(3, Math.round((zoom + (command === "in" ? .1 : -.1)) * 100) / 100));
  updatePager(); scheduleZoomPersist();
  renderToken += 1;
  clearTimeout(window.__zbKeyboardZoomTimer);
  window.__zbKeyboardZoomTimer = setTimeout(() => layoutPages(renderToken), 60);
  return zoom;
}
window.zbZoomPdfPage = zbZoomPdfPage;

btnZoomIn.addEventListener("click", () => {
  fitWidth = false;
  zoom = Math.min(4, zoom + 0.15);
  scheduleZoomPersist();
  renderToken += 1;
  layoutPages(renderToken);
});
btnZoomOut.addEventListener("click", () => {
  fitWidth = false;
  zoom = Math.max(0.3, zoom - 0.15);
  scheduleZoomPersist();
  renderToken += 1;
  layoutPages(renderToken);
});
btnFit.addEventListener("click", () => {
  fitWidth = true;
  scheduleZoomPersist();
  renderToken += 1;
  layoutPages(renderToken);
});

// ---------- PDF 链接层与划词上报 ----------

// Viewer → chrome channel. postMessage from a content <browser> is unreliable
// in Zotero, so events are ALSO queued on window.__zbEvents (drained by the
// privileged parent via wrappedJSObject), and — most direct — delivered
// through window.__zbNotify, a callback the chrome side injects into this
// same-process window.
window.__zbEvents = [];
function emit(evt) {
  try {
    if (typeof window.__zbNotify === "function") {
      window.__zbNotify(evt);
    }
  } catch (e) {}
  try {
    window.__zbEvents.push(evt);
    if (window.__zbEvents.length > 60) {
      window.__zbEvents.shift();
    }
  } catch (e) {}
  try {
    window.parent.postMessage(evt, "*");
  } catch (e) {}
}

function pdfDebug(msg) {
  emit({ type: "zb-pdf-debug", message: String(msg) });
}

/**
 * Hand-rolled text layer: absolutely positioned transparent spans over the
 * canvas so PDF text can be drag-selected and copied. Positions come from
 * composing each text item's matrix with the CSS-scale viewport matrix.
 */
async function buildTextLayer(page, wrap, cssScale) {
  let viewport = page.getViewport({ scale: cssScale });
  let textContent = await page.getTextContent();
  let items = textContent && textContent.items;
  if (!items || !items.length) {
    return;
  }
  let layer = document.createElement("div");
  layer.className = "textLayer";
  let frag = document.createDocumentFragment();
  let spans = [];
  for (let item of items) {
    try {
      let str = item.str;
      if (!str) {
        continue;
      }
      let tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      let fontHeight = Math.hypot(tx[2], tx[3]);
      if (!fontHeight || fontHeight < 0.5) {
        continue;
      }
      let span = document.createElement("span");
      span.textContent = str;
      span.style.left = tx[4] + "px";
      span.style.top = (tx[5] - fontHeight) + "px";
      span.style.fontSize = fontHeight + "px";
      span.style.fontFamily = "sans-serif";
      // 显式收紧 span 盒子高度：不设高度时相邻行/上下标的盒子会互相重叠，
      // 划词命中测试容易窜到上一行（向下选时选区"飘"到上方）。
      span.style.height = fontHeight + "px";
      span.style.lineHeight = "1";
      if (item.width > 0) {
        span.dataset.zbw = String(item.width * cssScale);
      }
      frag.appendChild(span);
      spans.push(span);
    } catch (e) {}
  }
  layer.appendChild(frag);
  wrap.appendChild(layer);
  // 用 scaleX 把透明文字拉伸到 PDF 实际排版宽度：这样选区高亮与画布上的
  // 字形逐字对齐（两端对齐的行也能严丝合缝）。命中测试已由文件底部的
  // 自定义几何划词接管，transform 不再影响鼠标定位。
  if (!zbMeasureCtx) {
    zbMeasureCtx = document.createElement("canvas").getContext("2d");
  }
  let geo = [];
  for (let span of spans) {
    let text = span.textContent || "";
    if (!text.length) {
      continue;
    }
    let fs = parseFloat(span.style.fontSize) || 10;
    zbMeasureCtx.font = fs + "px sans-serif";
    let mw = zbMeasureCtx.measureText(text).width;
    let w = parseFloat(span.dataset.zbw || "0") || mw;
    let ratio = mw > 0.01 ? w / mw : 1;
    if (ratio > 0.25 && ratio < 4 && Math.abs(ratio - 1) > 0.01) {
      span.style.transform = "scaleX(" + ratio.toFixed(3) + ")";
    } else {
      ratio = 1;
    }
    geo.push({
      node: span.firstChild,
      len: text.length,
      l: parseFloat(span.style.left) || 0,
      t: parseFloat(span.style.top) || 0,
      w,
      mw,
      ratio,
      fs,
      h: parseFloat(span.style.height) || 0
    });
  }
  // 缓存文本几何信息，供自定义划词命中使用（见文件底部拖拽选择逻辑）
  wrap.__zbSpanGeo = geo.filter(g => g.node && g.len > 0 && g.w > 0);
}

async function buildLinkLayer(page, wrap, cssScale) {
  let annotations = await page.getAnnotations({ intent: "display" });
  let links = (annotations || []).filter((a) => a && a.subtype === "Link");
  if (!links.length) {
    return;
  }
  let cssViewport = page.getViewport({ scale: cssScale });
  let layer = document.createElement("div");
  layer.className = "linkLayer";
  for (let a of links) {
    if (!a.rect) {
      continue;
    }
    let r = cssViewport.convertToViewportRectangle(a.rect);
    let left = Math.min(r[0], r[2]);
    let top = Math.min(r[1], r[3]);
    let w = Math.abs(r[0] - r[2]);
    let h = Math.abs(r[1] - r[3]);
    if (w < 2 || h < 2) {
      continue;
    }
    let link = document.createElement("a");
    link.style.left = left + "px";
    link.style.top = top + "px";
    link.style.width = w + "px";
    link.style.height = h + "px";
    let url = a.url || a.unsafeUrl || "";
    // Some PDFs store bare hostnames (doi.org/...) or other schemes in URI
    // annotations; normalize so reference links always open.
    if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url) &&
        /^[\w.-]+\.[a-z]{2,}([/?#]|$)/i.test(url)) {
      url = "https://" + url;
    }
    if (url && /^https?:/i.test(url)) {
      link.href = url;
      link.title = url;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        emit({ type: "zb-pdf-openlink", url });
      });
      link.addEventListener("mouseenter", () => {
        scheduleLinkPreview(link, { url });
      });
      link.addEventListener("mouseleave", () => {
        scheduleHideLinkPreview();
      });
    } else if (a.dest) {
      link.href = "#";
      link.title = "跳转到文档内位置";
      let dest = a.dest;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        goToDest(dest);
      });
      link.addEventListener("mouseenter", () => {
        scheduleLinkPreview(link, { dest });
      });
      link.addEventListener("mouseleave", () => {
        scheduleHideLinkPreview();
      });
    } else {
      continue;
    }
    layer.appendChild(link);
  }
  if (layer.childElementCount) {
    wrap.appendChild(layer);
  } else if (links.length) {
    let sample = links.slice(0, 3).map((a) =>
      JSON.stringify({ url: a.url, unsafeUrl: a.unsafeUrl, dest: !!a.dest, action: a.action })
    ).join(" | ");
    pdfDebug("链接层 page=" + page.pageNumber + " 有" + links.length + "个注释但均不可用: " + sample);
  }
}

async function goToDest(dest) {
  try {
    if (!pdfDoc) {
      return;
    }
    let d = typeof dest === "string" ? await pdfDoc.getDestination(dest) : dest;
    if (!d || d[0] == null) {
      return;
    }
    let pageIndex = typeof d[0] === "number" ? d[0] : await pdfDoc.getPageIndex(d[0]);
    let wrap = pageWraps[pageIndex];
    if (wrap) {
      wrap.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (e) {}
}

// ---------- 链接悬停预览 ----------
// 鼠标悬停在链接上（不点击）时浮现小窗：内部引用显示目标位置（如参考文献
// 条目）的页面快照，外部链接直接显示网址；快照区域内的网址注释会列为可直接
// 点击打开的行，无需先跳转再点链接。
let previewEl = null;
let previewHeaderEl = null;
let previewCanvas = null;
let previewListEl = null;
let previewShowTimer = 0;
let previewHideTimer = 0;
let previewToken = 0;
let previewRenderTask = null;
let destPointCache = new Map();
let pageAnnosCache = new Map();
let pageTextRowsCache = new Map();

function ensurePreviewEl() {
  if (previewEl) {
    return previewEl;
  }
  previewEl = document.createElement("div");
  previewEl.id = "link-preview";
  previewHeaderEl = document.createElement("div");
  previewHeaderEl.id = "link-preview-header";
  previewCanvas = document.createElement("canvas");
  previewListEl = document.createElement("div");
  previewListEl.id = "link-preview-links";
  previewEl.appendChild(previewHeaderEl);
  previewEl.appendChild(previewCanvas);
  previewEl.appendChild(previewListEl);
  previewEl.addEventListener("mouseenter", () => {
    clearTimeout(previewHideTimer);
  });
  previewEl.addEventListener("mouseleave", () => {
    scheduleHideLinkPreview();
  });
  (document.body || document.documentElement).appendChild(previewEl);
  return previewEl;
}

function hideLinkPreview() {
  clearTimeout(previewShowTimer);
  clearTimeout(previewHideTimer);
  if (previewRenderTask) {
    try { previewRenderTask.cancel(); } catch (e) {}
    previewRenderTask = null;
  }
  previewToken++;
  if (previewEl) {
    previewEl.style.display = "none";
  }
}

function scheduleHideLinkPreview() {
  previewToken++;
  if (previewRenderTask) {
    try { previewRenderTask.cancel(); } catch (e) {}
    previewRenderTask = null;
  }
  clearTimeout(previewShowTimer);
  clearTimeout(previewHideTimer);
  previewHideTimer = setTimeout(hideLinkPreview, 220);
}

function scheduleLinkPreview(anchor, info) {
  hideLinkPreview();
  let token = previewToken;
  previewShowTimer = setTimeout(() => {
    showLinkPreview(anchor, info, token);
  }, 350);
}

function positionLinkPreview(anchor) {
  let r = anchor.getBoundingClientRect();
  let el = previewEl;
  el.style.visibility = "hidden";
  el.style.display = "block";
  let pw = el.offsetWidth;
  let ph = el.offsetHeight;
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let x = Math.max(8, Math.min(r.left, vw - pw - 8));
  let y = r.bottom + 6;
  if (y + ph > vh - 8) {
    y = r.top - ph - 6;
    if (y < 8) {
      y = Math.max(8, vh - ph - 8);
    }
  }
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.visibility = "visible";
}

// 解析内部跳转到「页码 + scale=1 视口坐标」，结果带缓存。
function resolveDestPoint(dest) {
  let key = typeof dest === "string" ? "s:" + dest : "a:" + JSON.stringify(dest);
  if (destPointCache.has(key)) {
    return destPointCache.get(key);
  }
  let sourceDocument = pdfDoc;
  let promise = (async () => {
    try {
      let d = typeof dest === "string" ? await sourceDocument.getDestination(dest) : dest;
      if (!Array.isArray(d) || d[0] == null) {
        return null;
      }
      let ref = d[0];
      let pageIndex = typeof ref === "object" ? await sourceDocument.getPageIndex(ref) : ref;
      let page = await sourceDocument.getPage(pageIndex + 1);
      let baseVp = page.getViewport({ scale: 1 });
      let x = null;
      let y = 0;
      let hasCoordinates = false;
      let mode = d[1] && d[1].name;
      if (mode === "XYZ") {
        let py = d[3] != null ? d[3] : baseVp.height;
        [x, y] = baseVp.convertToViewportPoint(d[2] != null ? d[2] : 0, py);
        if (d[2] == null) x = null;
        hasCoordinates = Number.isFinite(d[3]);
      } else if (mode === "FitH" || mode === "FitBH") {
        let py = d[2] != null ? d[2] : baseVp.height;
        [, y] = baseVp.convertToViewportPoint(0, py);
        hasCoordinates = Number.isFinite(d[2]);
      }
      return { pageNumber: pageIndex + 1, x, y, hasCoordinates };
    } catch (e) {
      return null;
    }
  })();
  destPointCache.set(key, promise);
  return promise;
}

// 每页的链接注释（scale=1 视口坐标），带缓存。
function getPageLinkAnnotations(pageNumber) {
  if (pageAnnosCache.has(pageNumber)) {
    return pageAnnosCache.get(pageNumber);
  }
  let sourceDocument = pdfDoc;
  let promise = (async () => {
    try {
      let page = await sourceDocument.getPage(pageNumber);
      let annos = await page.getAnnotations({ intent: "display" });
      let baseVp = page.getViewport({ scale: 1 });
      let out = [];
      for (let a of annos || []) {
        if (!a || a.subtype !== "Link" || !a.rect) {
          continue;
        }
        let r = baseVp.convertToViewportRectangle(a.rect);
        out.push({
          url: a.url || a.unsafeUrl || "",
          rect: [
            Math.min(r[0], r[2]), Math.min(r[1], r[3]),
            Math.max(r[0], r[2]), Math.max(r[1], r[3])
          ]
        });
      }
      return out;
    } catch (e) {
      return [];
    }
  })();
  pageAnnosCache.set(pageNumber, promise);
  return promise;
}

function addPreviewLinkRow(url, snippet) {
  let box = document.createElement("div");
  box.className = "link-preview-ref";
  if (snippet) {
    let label = document.createElement("span");
    label.className = "link-preview-ref-label";
    label.textContent = snippet;
    label.title = snippet;
    box.appendChild(label);
  }
  let row = document.createElement("a");
  row.className = "link-preview-link";
  row.href = url;
  row.textContent = url.length > 64 ? url.slice(0, 61) + "…" : url;
  row.title = url;
  row.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideLinkPreview();
    emit({ type: "zb-pdf-openlink", url });
  });
  box.appendChild(row);
  previewListEl.appendChild(box);
}

// 把页面文本聚类成行（scale=1 视口坐标），用于给链接找所属参考文献条目。
function getPageTextRows(pageNumber) {
  if (pageTextRowsCache.has(pageNumber)) {
    return pageTextRowsCache.get(pageNumber);
  }
  let sourceDocument = pdfDoc;
  let promise = (async () => {
    try {
      let page = await sourceDocument.getPage(pageNumber);
      let tc = await page.getTextContent();
      let baseVp = page.getViewport({ scale: 1 });
      return ZBPDFLinkPreview.textRows(tc.items, baseVp);
    } catch (e) {
      return [];
    }
  })();
  pageTextRowsCache.set(pageNumber, promise);
  return promise;
}

async function showLinkPreview(anchor, info, token = ++previewToken) {
  if (!pdfDoc || !document.contains(anchor) || token !== previewToken) {
    return;
  }
  ensurePreviewEl();
  const sourceDocument = pdfDoc;
  previewHeaderEl.innerHTML = "";
  previewListEl.innerHTML = "";
  previewCanvas.style.display = "none";

  if (info.url) {
    // 外部链接：直接给出可点击的网址
    previewHeaderEl.textContent = "点击打开链接";
    addPreviewLinkRow(info.url);
    positionLinkPreview(anchor);
    return;
  }

  if (!info.dest) {
    return;
  }
  let p = await resolveDestPoint(info.dest);
  if (token !== previewToken || !p) {
    return;
  }
  let label = document.createElement("span");
  label.textContent = "引用预览 · 第 " + p.pageNumber + " 页";
  let jumpBtn = document.createElement("button");
  jumpBtn.textContent = "跳转";
  jumpBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideLinkPreview();
    goToDest(info.dest);
  });
  previewHeaderEl.appendChild(label);
  previewHeaderEl.appendChild(jumpBtn);

  try {
    let page = await sourceDocument.getPage(p.pageNumber);
    if (token !== previewToken || !document.contains(anchor)) return;
    let baseVp = page.getViewport({ scale: 1 });
    const W = 420;
    let scale = W / baseVp.width;
    let startY = Math.max(0, p.y - 6);
    let availH = (baseVp.height - startY) * scale;
    let H = Math.max(60, Math.min(240, availH));
    let dpr = window.devicePixelRatio || 1;
    // Each request owns its canvas; stale render tasks cannot paint over a new link.
    let canvas = document.createElement("canvas");
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    let ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // viewport 用 scale=1，位移/缩放全部放进 transform，避免依赖 offsetY 语义
    let renderTask = page.render({
      canvasContext: ctx,
      viewport: baseVp,
      transform: [dpr * scale, 0, 0, dpr * scale, 0, -dpr * scale * startY],
      background: "#ffffff"
    });
    previewRenderTask = renderTask;
    await renderTask.promise;
    if (previewRenderTask === renderTask) previewRenderTask = null;
    if (token !== previewToken || !document.contains(anchor)) {
      return;
    }
    previewCanvas.replaceWith(canvas);
    previewCanvas = canvas;
    previewCanvas.style.display = "block";

    // Restrict URLs to the destination reference, not every link in the screenshot.
    let [annos, rows] = await Promise.all([
      getPageLinkAnnotations(p.pageNumber), getPageTextRows(p.pageNumber)
    ]);
    if (token !== previewToken || !document.contains(anchor)) return;
    let region = ZBPDFLinkPreview.referenceRegion(rows, p);
    let hits = ZBPDFLinkPreview.linksForReference(annos, region);
    for (let hit of hits) addPreviewLinkRow(hit.url, region.snippet);
    if (!hits.length) {
      let tip = document.createElement("div");
      tip.className = "link-preview-tip";
      tip.textContent = "无法确定这条引用的外部链接，请点击“跳转”查看原文。";
      previewListEl.appendChild(tip);
    }
  } catch (e) {
    // 渲染失败时仍保留「跳转」按钮可用
  }
  if (token === previewToken && document.contains(anchor)) {
    positionLinkPreview(anchor);
  }
}

// Report text selection to the parent chrome window so it can offer the
// translate popover (uses the user's installed Translate-for-Zotero plugin).
let lastReportedSelection = "";
function reportSelection() {
  try {
    let sel = window.getSelection();
    let text = sel ? String(sel).trim() : "";
    if (text === lastReportedSelection) {
      return;
    }
    lastReportedSelection = text;
    let rect = null;
    if (text && sel.rangeCount) {
      let r = sel.getRangeAt(0).getBoundingClientRect();
      rect = { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom };
    }
    let node = sel && sel.anchorNode;
    let element = node && (node.nodeType === 1 ? node : node.parentElement);
    let page = Number(element && element.closest(".page-wrap")?.dataset.page) || null;
    emit({ type: "zb-pdf-selection", text, rect, page });
  } catch (e) {}
}
document.addEventListener("mouseup", () => setTimeout(reportSelection, 10));
document.addEventListener("keyup", (e) => {
  if (e.shiftKey || e.key === "Shift") {
    setTimeout(reportSelection, 10);
  }
});
document.addEventListener("selectionchange", () => {
  let sel = window.getSelection();
  if (!sel || !String(sel).trim()) {
    lastReportedSelection = "";
    emit({ type: "zb-pdf-selection", text: "", rect: null });
  }
});

pagesEl.addEventListener("scroll", () => {
  hideLinkPreview();
  if (!pageWraps.length) {
    return;
  }
  let mid = pagesEl.scrollTop + pagesEl.clientHeight / 3;
  for (let i = 0; i < pageWraps.length; i++) {
    let wrap = pageWraps[i];
    if (wrap && wrap.offsetTop + wrap.offsetHeight > mid) {
      currentPage = i + 1;
      updatePager();
      break;
    }
  }
});

// ---------- 自定义划词选择 ----------
// Gecko 对「绝对定位 + 手写文本层」的原生命中测试不可靠：划到行尾/行间/
// 页面空白处时选区会"就近"吸附到上一行。这里完全接管拖动选择：按鼠标
// 坐标做几何命中——先定位鼠标所在行（垂直最近），再定位行内字符（水平
// 最近），鼠标在哪就选哪，空白处则钳位到该行行首/行尾。
// 用与透明文字实际渲染相同的字体度量做逐字符二分定位。透明文字被
// scaleX(ratio) 拉伸到 PDF 排版宽度，先把指针横坐标换算回未拉伸坐标系，
// 再二分查找字符边界，保证选区与画布上的字形逐字对齐。
function zbSpanCharOffset(g, x) {
  let text = g.node.textContent;
  let ratio = g.ratio || 1;
  let rel = (x - g.l) / ratio;
  if (rel <= 0) {
    return 0;
  }
  if (rel >= g.mw) {
    return g.len;
  }
  if (!zbMeasureCtx) {
    zbMeasureCtx = document.createElement("canvas").getContext("2d");
  }
  zbMeasureCtx.font = g.fs + "px sans-serif";
  let lo = 0;
  let hi = g.len;
  while (lo < hi) {
    let mid = (lo + hi) >> 1;
    if (zbMeasureCtx.measureText(text.slice(0, mid)).width < rel) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo > 0) {
    let wPrev = zbMeasureCtx.measureText(text.slice(0, lo - 1)).width;
    let wCur = zbMeasureCtx.measureText(text.slice(0, lo)).width;
    if (rel - wPrev < wCur - rel) {
      lo--;
    }
  }
  return lo;
}

function zbLocatePosition(geo, x, y) {
  if (!geo || !geo.length) {
    return null;
  }
  // 1) 垂直方向：包含 y 的行（容差 1px）
  let line = geo.filter(g => y >= g.t - 1 && y <= g.t + g.h + 1);
  if (!line.length) {
    // 不在任何行内：取垂直距离最近的一行（t 相近视为同一行）
    let best = Infinity;
    let bestT = 0;
    for (let g of geo) {
      let d = y < g.t ? g.t - y : y - (g.t + g.h);
      if (d < best) {
        best = d;
        bestT = g.t;
      }
    }
    line = geo.filter(g => Math.abs(g.t - bestT) < 2);
  }
  // 2) 水平方向：x 落在某 span 内 → 逐字符二分定位
  for (let g of line) {
    if (x >= g.l && x <= g.l + g.w) {
      return { node: g.node, off: zbSpanCharOffset(g, x) };
    }
  }
  // 3) x 在行内空白处：钳位到最近的 span 边缘（行首左侧/行尾右侧）
  let bestG = null;
  let bestD = Infinity;
  for (let g of line) {
    let d = x < g.l ? g.l - x : x - (g.l + g.w);
    if (d < bestD) {
      bestD = d;
      bestG = g;
    }
  }
  if (!bestG) {
    return null;
  }
  return { node: bestG.node, off: x < bestG.l ? 0 : bestG.len };
}

function zbPickWrapAt(clientX, clientY) {
  let best = null;
  let bestD = Infinity;
  for (let wrap of pageWraps) {
    if (!wrap || !wrap.__zbSpanGeo || !wrap.__zbSpanGeo.length) {
      continue;
    }
    let r = wrap.getBoundingClientRect();
    let dy = clientY < r.top ? r.top - clientY
      : (clientY > r.bottom ? clientY - r.bottom : 0);
    if (dy < bestD) {
      bestD = dy;
      best = { wrap, r };
    }
  }
  return best;
}

let zbDragAnchor = null;

function zbUpdateDragSelection(e) {
  if (!zbDragAnchor) {
    return;
  }
  let pick = zbPickWrapAt(e.clientX, e.clientY);
  if (!pick) {
    return;
  }
  let pos = zbLocatePosition(
    pick.wrap.__zbSpanGeo,
    e.clientX - pick.r.left,
    e.clientY - pick.r.top
  );
  if (!pos) {
    return;
  }
  try {
    window.getSelection().setBaseAndExtent(
      zbDragAnchor.node, zbDragAnchor.off, pos.node, pos.off
    );
  } catch (err) {}
}

pagesEl.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.detail > 1) {
    return; // 双击及以上交给原生（单词/段落选择）
  }
  let t = e.target;
  if (t && t.closest && t.closest(".linkLayer a")) {
    return; // 链接点击不接管
  }
  let inPage = t && t.closest && t.closest(".page-wrap");
  if (!inPage) {
    return;
  }
  e.preventDefault(); // 阻止原生拖动选择，改由几何命中驱动
  let pick = zbPickWrapAt(e.clientX, e.clientY);
  if (!pick) {
    return;
  }
  let pos = zbLocatePosition(
    pick.wrap.__zbSpanGeo,
    e.clientX - pick.r.left,
    e.clientY - pick.r.top
  );
  if (!pos) {
    try {
      window.getSelection().removeAllRanges();
    } catch (err) {}
    return;
  }
  zbDragAnchor = pos;
  try {
    window.getSelection().setBaseAndExtent(pos.node, pos.off, pos.node, pos.off);
  } catch (err) {}
  let onMove = (ev) => {
    // 指针靠近容器上下边缘时自动滚动，方便跨页拖选
    try {
      let pv = pagesEl.getBoundingClientRect();
      if (ev.clientY < pv.top + 30) {
        pagesEl.scrollTop -= 18;
      } else if (ev.clientY > pv.bottom - 30) {
        pagesEl.scrollTop += 18;
      }
    } catch (err) {}
    zbUpdateDragSelection(ev);
  };
  let onUp = () => {
    zbDragAnchor = null;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    setTimeout(reportSelection, 10);
  };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
}, true);

// Cmd/Ctrl + wheel (also covers macOS trackpad pinch, which Gecko reports as
// ctrlKey wheel) zooms the PDF around the current fit state.
// 平滑策略：缩放系数与滚动量成正比（触控板捏合不再一顿一顿）；每一帧只
// 拉伸已有渲染结果（瞬时反馈），停顿 160ms 后才按目标缩放清晰重渲。
pagesEl.addEventListener("wheel", (e) => {
  if (!pdfDoc || !(e.metaKey || e.ctrlKey)) {
    return;
  }
  e.preventDefault();
  fitWidth = false;
  let dy = e.deltaY;
  if (e.deltaMode === 1) {
    dy *= 33; // 行滚动（鼠标滚轮）换算成像素量级
  }
  let factor = Math.exp(-dy * 0.0022);
  zoom = Math.max(0.3, Math.min(4, zoom * factor));
  updatePager();
  previewZoomStretch();
  scheduleZoomPersist();
  clearTimeout(window.__zbWheelZoomTimer);
  window.__zbWheelZoomTimer = setTimeout(() => {
    renderToken += 1;
    layoutPages(renderToken);
  }, 160);
}, { passive: false });

window.addEventListener("message", (event) => {
  let data = event.data;
  if (!data) {
    return;
  }
  if (data.type === "zb-pdf-close") {
    destroyDoc();
    hideError();
    setStatus("");
    return;
  }
  if (data.type !== "zb-pdf-open") {
    return;
  }
  openPdf(data);
});

if (typeof ResizeObserver !== "undefined") {
  let ro = new ResizeObserver((entries) => {
    if (!pdfDoc || !fitWidth) return;
    for (let entry of entries) {
      let w = entry.contentRect.width;
      if (w > 50 && Math.abs(w - 24 - lastLayoutWidth) > 3) {
        clearTimeout(window.__zbResizeTimer);
        window.__zbResizeTimer = setTimeout(() => {
          renderToken += 1;
          layoutPages(renderToken);
        }, 50);
      }
    }
  });
  ro.observe(pagesEl);
}

window.addEventListener("resize", () => {
  if (!pdfDoc || !fitWidth) {
    return;
  }
  clearTimeout(window.__zbResizeTimer);
  window.__zbResizeTimer = setTimeout(() => {
    renderToken += 1;
    layoutPages(renderToken);
  }, 60);
});

// Expose a direct same-process hand-off for the privileged parent. postMessage
// remains available as a compatibility path, but the explicit function avoids
// losing large ArrayBuffers while Gecko is changing browser remoteness.
window.zbOpenPdf = openPdf;
window.__zbPdfReady = true;

try {
  emit({ type: "zb-pdf-ready" });
} catch (e) {}

try {
  let initialUrl = new URL(window.location.href).searchParams.get("file");
  if (initialUrl) {
    openPdfUrl(initialUrl);
  }
} catch (e) {
  showError("无法读取在线 PDF 地址：" + e);
}
