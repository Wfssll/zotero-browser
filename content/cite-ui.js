/* Cite content and an internal popup that leaves the reader layout intact. */
function zbCreateCitePopup(doc, service, options = {}) {
  const root = doc.createElement("div");
  root.className = "zb-cite-popup";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Cite · NASA ADS BibTeX");
  root.tabIndex = -1;
  root.style.cssText = "position:fixed;top:72px;right:20px;z-index:10005;display:none;flex-direction:column;width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 96px);overflow:hidden;box-sizing:border-box;border:1px solid var(--material-border,#d1d5db);border-radius:10px;background:var(--material-sidepane,#fff);color:var(--fill-primary,#212529);box-shadow:0 10px 30px rgba(0,0,0,.2);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;";
  const header = doc.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--material-border,#d1d5db);flex:0 0 auto;font-size:13px;";
  const title = doc.createElement("strong"); title.textContent = "Cite";
  const closeButton = doc.createElement("button");
  closeButton.type = "button"; closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "关闭 Cite");
  closeButton.style.cssText = "border:none;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:0 4px;";
  header.appendChild(title); header.appendChild(closeButton); root.appendChild(header);
  const panel = zbCreateCitePanel(doc, service, options);
  panel.root.style.flex = "1 1 auto";
  root.appendChild(panel.root);
  function hide() { root.style.display = "none"; options.onClose?.(); }
  const keydown = event => {
    if (root.style.display !== "none" && event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); hide();
    }
  };
  closeButton.addEventListener("click", hide);
  doc.addEventListener("keydown", keydown, true);
  return { root, panel,
    isOpen: () => root.style.display !== "none",
    show() { root.style.display = "flex"; root.focus?.(); },
    hide,
    dispose() { panel.dispose(); doc.removeEventListener("keydown", keydown, true); root.remove(); }
  };
}

function zbCreateCitePanel(doc, service, options = {}) {
  const root = doc.createElement("div");
  root.className = "zb-cite-panel";
  root.style.cssText = "padding:10px;min-height:0;overflow:auto;box-sizing:border-box;font-size:12px;line-height:1.5;color:var(--fill-primary,#212529);background:var(--material-sidepane,#fff);";
  let source = null, result = null, report = null, queue = [], generation = 0;
  let busy = false, batchBusy = false, cancelled = false, disposed = false;
  const controls = [];
  const element = (tag, text, parent = root) => {
    const node = doc.createElement(tag); if (text) node.textContent = text; parent.appendChild(node); return node;
  };
  const row = () => { const node = element("div"); node.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0;"; return node; };
  function button(label, action, parent) {
    const node = element("button", label, parent || row()); node.type = "button";
    node.style.cssText = "font:inherit;padding:4px 8px;border:1px solid var(--material-border,#d1d5db);border-radius:4px;cursor:pointer;background:var(--material-background,#f3f4f6);color:inherit;";
    controls.push(node);
    node.addEventListener("click", async () => {
      try { await action(); } catch (error) { status.textContent = error.message || String(error); }
    });
    return node;
  }
  const heading = element("strong", "Cite · NASA ADS BibTeX");
  heading.style.fontSize = "13px";
  const inputRow = row();
  const input = element("input", "", inputRow); input.type = "text";
  input.placeholder = "arXiv PDF／摘要链接、DOI 或 ADS 文章链接";
  input.style.cssText = "flex:1;min-width:180px;padding:5px;font:inherit;color:inherit;background:var(--material-background,#fff);border:1px solid var(--material-border,#d1d5db);border-radius:4px;";
  controls.push(input);
  button("获取", () => load(currentSource()), inputRow);
  const status = element("div"); status.setAttribute("role", "status");
  status.style.cssText = "margin:5px 0;overflow-wrap:anywhere;";
  const adsLink = element("a"); adsLink.target = "_blank";
  adsLink.style.cssText = "color:var(--fill-link,#2563eb);display:none;overflow-wrap:anywhere;";
  adsLink.addEventListener("click", event => { event.preventDefault(); if (result) options.openURL?.(result.adsURL); });
  const text = element("textarea"); text.readOnly = true;
  text.setAttribute("aria-label", "NASA ADS BibTeX");
  text.style.cssText = "display:block;width:100%;height:175px;box-sizing:border-box;resize:vertical;padding:8px;margin:6px 0;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:inherit;background:var(--material-background,#fff);border:1px solid var(--material-border,#d1d5db);border-radius:4px;";
  const actions = row();
  const copy = button("复制 BibTeX", async () => { await options.copy(text.value); status.textContent = "已复制 BibTeX 到剪贴板"; }, actions);
  const save = button("保存独立 Cite 笔记", async () => {
    const saved = await service.save(source, result); status.textContent = saved.created ? "已创建独立 Cite 笔记" : "已更新已有 Cite 笔记";
  }, actions);
  const exportButton = button("另存 .bib", () => options.exportFile(text.value), actions);
  const refresh = button("从 ADS 刷新", () => load(source || currentSource(), true), actions);
  const autoRow = row();
  const autoCopyLabel = element("label", "", autoRow);
  const autoCopy = element("input", "", autoCopyLabel); autoCopy.type = "checkbox"; autoCopy.checked = options.getAutoCopy?.() === true;
  autoCopyLabel.appendChild(doc.createTextNode(" 获取后自动复制"));
  autoCopy.addEventListener("change", () => options.setAutoCopy?.(autoCopy.checked));

  const batchBox = element("details"); batchBox.style.cssText = "border-top:1px solid var(--material-border,#d1d5db);padding-top:6px;margin-top:6px;";
  element("summary", "批量获取与保存 Zotero 文章", batchBox).style.cursor = "pointer";
  const batchRow = element("div", "", batchBox); batchRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0;";
  const scope = element("select", "", batchRow); scope.style.cssText = "font:inherit;padding:4px;color:inherit;background:var(--material-background,#fff);";
  for (const [value, label] of [["selected", "选中的文章（可单篇）"], ["collection", "当前分类文件夹"], ["library", "当前资料库全部文章"]]) {
    const option = element("option", label, scope); option.value = value;
  }
  controls.push(scope);
  const recursiveLabel = element("label", "", batchRow);
  const recursive = element("input", "", recursiveLabel); recursive.type = "checkbox"; recursive.checked = true;
  recursiveLabel.appendChild(doc.createTextNode(" 包含子文件夹")); controls.push(recursive);
  const batchStatus = element("div", "", batchBox); batchStatus.setAttribute("role", "status");
  const log = element("div", "", batchBox); log.style.cssText = "max-height:180px;overflow:auto;overflow-wrap:anywhere;";
  const batchActions = element("div", "", batchBox); batchActions.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;";
  button("检查范围", async () => {
    queue = await service.targets(scope.value, options.getPane(), recursive.checked);
    batchStatus.textContent = "当前范围共 " + queue.length + " 篇文章；运行时逐篇保存为独立 Cite 笔记。";
  }, batchActions);
  const start = button("获取并逐篇保存", () => runBatch(false), batchActions);
  const retry = button("重试失败／未完成", () => runBatch(true), batchActions); retry.disabled = true;
  const cancel = button("停止", () => { cancelled = true; batchStatus.textContent = "正在停止，已保存的记录会保留…"; }, batchActions); cancel.disabled = true;
  const batchCopy = button("复制本次全部 BibTeX", () => options.copy(service.combine(report.completed.map(r => r.result))), batchActions); batchCopy.disabled = true;
  const batchExport = button("本次另存 .bib", () => options.exportFile(service.combine(report.completed.map(r => r.result))), batchActions); batchExport.disabled = true;
  element("div", "每篇文章单独保存，Cite 与生词记录分开。未收录／无法精确匹配的条目会列出原因。", batchBox).style.color = "var(--fill-secondary,#666)";

  const settings = element("details"); settings.style.marginTop = "8px";
  element("summary", "ADS 连接设置（可选）", settings).style.cursor = "pointer";
  element("div", "默认使用 ADS 访客入口；较大批量可填写个人 API Token。", settings);
  const token = element("input", "", settings); token.type = "password"; token.autocomplete = "off"; token.placeholder = "个人 ADS API Token";
  token.style.cssText = "width:100%;box-sizing:border-box;font:inherit;padding:5px;margin:5px 0;";
  const tokenStatus = element("div", options.hasToken?.() ? "已配置个人 Token" : "使用 ADS 访客入口", settings);
  const settingsRow = element("div", "", settings); settingsRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
  button("保存 Token", async () => { await options.setToken(token.value.trim()); token.value = ""; tokenStatus.textContent = options.hasToken() ? "已配置个人 Token" : "使用 ADS 访客入口"; }, settingsRow);
  button("清除 Token", async () => { await options.setToken(""); token.value = ""; tokenStatus.textContent = "使用 ADS 访客入口"; }, settingsRow);
  button("打开 ADS Token 页面", () => options.openURL("https://ui.adsabs.harvard.edu/user/settings/token"), settingsRow);

  function availability() {
    for (const control of controls) control.disabled = busy || batchBusy;
    copy.disabled = exportButton.disabled = !result || busy || batchBusy;
    save.disabled = !result || !source || busy || batchBusy;
    refresh.disabled = !source || busy || batchBusy;
    retry.disabled = !report || (!report.failed.length && report.completed.length === report.total) || busy || batchBusy;
    cancel.disabled = !batchBusy;
    batchCopy.disabled = batchExport.disabled = !report?.completed.length || busy || batchBusy;
  }
  function currentSource() {
    if (input.value.trim()) return options.sourceFromInput(input.value.trim());
    return options.getSource();
  }
  function show(resultValue) {
    result = resultValue; text.value = resultValue.bibtex;
    adsLink.textContent = resultValue.title + " · " + resultValue.bibcode;
    adsLink.href = resultValue.adsURL; adsLink.style.display = "block";
  }
  async function load(nextSource, force = false) {
    const tick = ++generation;
    source = nextSource; result = null; text.value = ""; adsLink.style.display = "none";
    busy = true; availability(); status.textContent = "正在从 NASA ADS 获取…";
    try {
      const nextResult = await service.retrieve(nextSource, force);
      if (disposed || tick !== generation) return;
      show(nextResult);
      status.textContent = nextResult.saved ? "已读取保存的 ADS 引用；可点击“从 ADS 刷新”获取最新版本。" : "已获取 NASA ADS BibTeX（保留全部作者）";
      if (autoCopy.checked) { await options.copy(nextResult.bibtex); status.textContent += " · 已复制"; }
    } catch (error) { if (!disposed && tick === generation) status.textContent = error.message; }
    finally { if (tick === generation) { busy = false; availability(); } }
  }
  async function runBatch(retryFailed) {
    if (batchBusy || busy) return;
    const previous = retryFailed ? report : null;
    if (retryFailed) {
      const done = new Set(report.completed.map(r => r.source.identity));
      queue = queue.filter(s => !done.has(s.identity));
    } else queue = await service.targets(scope.value, options.getPane(), recursive.checked);
    if (!queue.length) { batchStatus.textContent = "当前范围没有可处理的文章"; return; }
    batchBusy = true; cancelled = false; availability(); log.textContent = "";
    try {
      const next = await service.batch(queue, { cancelled: () => cancelled || disposed,
        onProgress: ({ index, total, source: item }) => {
          if (!disposed) batchStatus.textContent = "正在处理 " + Math.min(index + 1, total) + "/" + total + "：" + item.title;
        } });
      report = previous ? { ...next, total: previous.total, completed: [...previous.completed, ...next.completed] } : next;
      if (disposed) return;
      for (const failed of report.failed) element("div", "失败：" + failed.source.title + " — " + failed.error, log);
      const unprocessed = report.total - report.completed.length - report.failed.length;
      batchStatus.textContent = "已保存 " + report.completed.length + "/" + report.total + " 篇；失败 " + report.failed.length +
        " 篇" + (unprocessed ? "；未完成 " + unprocessed + " 篇" : "") + (report.cancelled ? " · 已停止" : report.stopped ? " · ADS 额度／授权限制" : "");
    } finally { batchBusy = false; availability(); }
  }
  availability();
  return { root, load,
    async setSource(nextSource, automatic = false) {
      const tick = ++generation; busy = false; source = nextSource; result = null; text.value = ""; adsLink.style.display = "none";
      input.value = ""; status.textContent = nextSource ? nextSource.title : "打开 arXiv PDF 后自动获取，也可输入链接或处理 Zotero 文章。";
      availability();
      if (automatic && nextSource && !batchBusy) await load(nextSource);
      else if (nextSource) {
        try {
          const saved = await service.stored(nextSource);
          if (!disposed && tick === generation && saved) {
            show(saved); status.textContent = "已读取保存的 ADS 引用；可点击“从 ADS 刷新”获取最新版本。"; availability();
          }
        } catch (error) { if (!disposed && tick === generation) status.textContent = error.message; }
      }
    },
    dispose() { disposed = true; cancelled = true; ++generation; }
  };
}
