/* Local-only home wallpaper preferences and gallery. */
var zbBackgrounds = (() => {
  const presets = [
    ["flaming-mountains", "火焰山"], ["galactic", "星际远航"],
    ["rainforest", "热带森林"], ["ice-mountains", "雪山冰原"],
    ["desert", "沙漠"], ["ocean", "大海"],
    ["grand-canyon", "大峡谷"], ["yellow-river", "黄河"]
  ].map(([id, label]) => ({ id, label, url: `chrome://zotero-browser/content/backgrounds/${id}.jpg`, thumbnail: `chrome://zotero-browser/content/backgrounds/${id}-thumb.jpg` }));
  function normalize(value = {}) {
    const id = ["none", "custom", ...presets.map(p => p.id)].includes(value.id) ? value.id : "none";
    return { id: id === "custom" && !value.customFile ? "none" : id,
      customFile: typeof value.customFile === "string" ? value.customFile : "",
      darkness: Number.isFinite(value.darkness) ? Math.max(0, Math.min(.7, value.darkness)) : .18,
      position: ["center", "top", "bottom"].includes(value.position) ? value.position : "center" };
  }
  function createService(options) {
    let state;
    try { state = normalize(JSON.parse(options.read() || "{}")); } catch (_) { state = normalize(); }
    const listeners = new Set();
    const snapshot = () => ({ ...state });
    function update(patch) {
      const next = normalize({ ...state, ...patch });
      options.write(JSON.stringify(next)); state = next;
      for (const listener of listeners) listener(snapshot());
      return snapshot();
    }
    return {
      presets, snapshot, update,
      url(value = state) { return value.id === "custom" ? options.fileURL(value.customFile) : presets.find(p => p.id === value.id)?.url || ""; },
      subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
      async importImage(win) {
        const file = await options.importImage(win); if (!file) return null;
        const previous = state.customFile;
        update({ customFile: file, id: "custom" });
        if (previous && previous !== file) await options.removeImage?.(previous);
        return snapshot();
      },
      async removeCustom() {
        const file = state.customFile;
        update({ customFile: "", ...(state.id === "custom" ? { id: "none" } : {}) });
        if (file) await options.removeImage?.(file);
      }
    };
  }
  function apply(view, service, value) {
    const url = service.url(value);
    view.classList.toggle("zb-home-has-background", !!url);
    view.style.backgroundImage = url ? `linear-gradient(rgba(0,0,0,${value.darkness}),rgba(0,0,0,${value.darkness})),url(${JSON.stringify(url)})` : "none";
    view.style.backgroundSize = "cover"; view.style.backgroundPosition = value.position;
    view.style.backgroundRepeat = "no-repeat";
  }
  function createGallery(doc, service, options = {}) {
    const root = doc.createElement("div"); root.className = "zb-wallpaper-gallery";
    const heading = doc.createElement("strong"); heading.textContent = "主页背景"; root.appendChild(heading);
    const hint = doc.createElement("div"); hint.className = "zb-wallpaper-hint";
    hint.textContent = "选择图片预览，满意后点击应用"; root.appendChild(hint);
    const hero = doc.createElement("div"); hero.className = "zb-wallpaper-hero"; root.appendChild(hero);
    const heroImage = doc.createElement("img"); heroImage.className = "zb-wallpaper-hero-image"; heroImage.alt = "";
    const empty = doc.createElement("span"); empty.textContent = "纯色背景 · 跟随界面配色";
    const shade = doc.createElement("div"); shade.className = "zb-wallpaper-hero-shade";
    hero.appendChild(heroImage); hero.appendChild(empty); hero.appendChild(shade);
    const summary = doc.createElement("div"); summary.className = "zb-wallpaper-summary"; root.appendChild(summary);
    const previewName = doc.createElement("span"); summary.appendChild(previewName);
    const applyButton = doc.createElement("button"); applyButton.type = "button";
    applyButton.className = "zb-btn-primary"; applyButton.textContent = "应用背景"; summary.appendChild(applyButton);
    const grid = doc.createElement("div"); grid.className = "zb-wallpaper-grid"; root.appendChild(grid);
    const buttons = [];
    let current = service.snapshot(), draft = { ...current }, imageFailed = false;
    const status = doc.createElement("div"); status.setAttribute("role", "status"); status.className = "zb-wallpaper-status";
    function choice(id, label, url) {
      const button = doc.createElement("button"); button.type = "button"; button.className = "zb-wallpaper-choice";
      button.setAttribute("aria-label", label); button.title = label;
      const preview = doc.createElement("div"); preview.className = "zb-wallpaper-preview";
      const image = doc.createElement("img"); image.alt = ""; image.className = "zb-wallpaper-thumbnail";
      // Real image elements and non-shrinking dimensions survive Zotero's native button rules.
      image.width = 120; image.height = 52; image.hidden = !url; if (url) image.src = url;
      const fallback = doc.createElement("span"); fallback.textContent = id === "none" ? "Aa" : "＋"; fallback.hidden = !!url;
      const badge = doc.createElement("span"); badge.className = "zb-wallpaper-current"; badge.textContent = "✓"; badge.title = "当前使用";
      preview.appendChild(image); preview.appendChild(fallback); preview.appendChild(badge);
      image.addEventListener("error", () => { image.hidden = true; fallback.hidden = false; fallback.textContent = "图片不可用"; });
      image.addEventListener("load", () => { image.hidden = false; fallback.hidden = true; });
      const text = doc.createElement("span"); text.className = "zb-wallpaper-label"; text.textContent = label;
      button.appendChild(preview); button.appendChild(text);
      button.addEventListener("click", () => { draft.id = id; status.textContent = ""; render(); });
      grid.appendChild(button); buttons.push({ id, label, button, image, fallback, badge }); return button;
    }
    choice("none", "纯色背景", "");
    for (const preset of service.presets) choice(preset.id, preset.label, preset.thumbnail);
    const custom = choice("custom", "我的图片", "");
    const controls = doc.createElement("div"); controls.className = "zb-wallpaper-controls"; root.appendChild(controls);
    const label = doc.createElement("label"); label.textContent = "背景遮罩";
    const range = doc.createElement("input"); range.type = "range"; range.min = "0"; range.max = "70"; range.step = "1";
    range.setAttribute("aria-label", "背景遮罩深度");
    const percent = doc.createElement("span");
    range.addEventListener("input", () => { draft.darkness = Number(range.value) / 100; render(); });
    label.appendChild(range); label.appendChild(percent); controls.appendChild(label);
    const position = doc.createElement("select"); position.setAttribute("aria-label", "背景显示位置");
    for (const [value, text] of [["center", "居中"], ["top", "靠上"], ["bottom", "靠下"]]) {
      const option = doc.createElement("option"); option.value = value; option.textContent = text; position.appendChild(option);
    }
    position.addEventListener("change", () => { draft.position = position.value; render(); }); controls.appendChild(position);
    const actions = doc.createElement("div"); actions.className = "zb-wallpaper-actions"; root.appendChild(actions);
    function action(text, callback) {
      const button = doc.createElement("button"); button.type = "button"; button.textContent = text;
      button.addEventListener("click", async () => {
        button.disabled = true; status.textContent = "";
        try { await callback(); } catch (error) { status.textContent = error.message || String(error); }
        finally { button.disabled = false; render(); }
      }); actions.appendChild(button); return button;
    }
    action("导入图片", async () => { if (await service.importImage(doc.defaultView)) status.textContent = "已导入并应用，图片保存在本机"; });
    const remove = action("移除我的图片", () => service.removeCustom());
    const reset = action("恢复当前", () => { draft = { ...current }; status.textContent = ""; });
    root.appendChild(status);
    function render() {
      for (const entry of buttons) {
        entry.button.setAttribute("aria-pressed", String(entry.id === draft.id));
        entry.badge.hidden = entry.id !== current.id;
        if (entry.id === "custom") {
          const url = current.customFile ? service.url({ ...current, id: "custom" }) : "";
          if (entry.image.getAttribute("src") !== url) {
            if (url) entry.image.src = url; else entry.image.removeAttribute("src");
            entry.image.hidden = !url; entry.fallback.hidden = !!url;
          }
        }
      }
      custom.disabled = !current.customFile; remove.disabled = !current.customFile;
      const pending = draft.id !== current.id || draft.darkness !== current.darkness || draft.position !== current.position;
      reset.disabled = !pending;
      const name = buttons.find(b => b.id === draft.id)?.label || "纯色背景";
      previewName.textContent = (pending ? "预览：" : "使用中：") + name;
      const url = service.url(draft);
      if (heroImage.getAttribute("src") !== url) {
        imageFailed = false;
        if (url) heroImage.src = url; else heroImage.removeAttribute("src");
      }
      heroImage.hidden = !url || imageFailed; empty.hidden = !!url && !imageFailed;
      empty.textContent = imageFailed ? "图片暂时无法预览" : "纯色背景 · 跟随界面配色";
      heroImage.style.objectPosition = draft.position; shade.style.background = `rgba(0,0,0,${url ? draft.darkness : 0})`;
      range.value = String(Math.round(draft.darkness * 100)); percent.textContent = range.value + "%"; position.value = draft.position;
      applyButton.disabled = !pending || imageFailed;
    }
    heroImage.addEventListener("error", () => { imageFailed = true; status.textContent = "无法读取背景图片，请重新选择或导入"; render(); });
    heroImage.addEventListener("load", () => { imageFailed = false; render(); });
    applyButton.addEventListener("click", () => { service.update(draft); status.textContent = "背景已应用"; });
    const unsubscribe = service.subscribe(value => { current = value; draft = { ...value }; render(); });
    function resetPreview() { current = service.snapshot(); draft = { ...current }; status.textContent = ""; render(); }
    return { root, dispose: unsubscribe, resetPreview };
  }
  return { presets, normalize, createService, apply, createGallery };
})();
