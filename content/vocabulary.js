/* Per-PDF bilingual notes, shared by the Zotero reader and browser preview. */
var zbVocabulary = (() => {
  const normalize = text => String(text || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, " ").trim();
  const escape = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function createService(Z) {
    const saves = new Map();
    let readerHandler = null;

    function readerSource(reader, annotation = {}) {
      const item = Z.Items.get(reader.itemID);
      if (!item || !item.isAttachment()) throw new Error("无法识别当前 PDF");
      const paper = item.parentID ? Z.Items.get(item.parentID) : item;
      const library = Z.Libraries.get(item.libraryID);
      const scope = library.libraryType === "group" ? "groups/" + library.libraryTypeID : "library";
      return {
        identity: "pdf:" + item.key, libraryID: item.libraryID, itemID: item.id,
        title: paper.getField("title") || item.getField("title"),
        href: "zotero://open-pdf/" + scope + "/items/" + item.key,
        pageLabel: annotation.pageLabel || "",
        page: Number.isInteger(annotation.position?.pageIndex) ? annotation.position.pageIndex + 1 : null,
        relatedItem: paper, collections: paper.getCollections()
      };
    }

    function previewSource(url, title, libraryID, collections = [], page = null) {
      return { identity: "url:" + url, href: url, title: title || url, libraryID, collections, page };
    }

    async function translation(source, text) {
      const plugin = Z.PDFTranslate;
      if (!plugin?.api?.translate) throw new Error("请先启用 Translate for Zotero 翻译插件");
      const queue = plugin.data?.translate?.queue || [];
      // Match BOTH the selected text and attachment; the plugin's latest task
      // may belong to a different reader or a concatenated selection.
      const task = [...queue].reverse().find(t => t.type === "text" &&
        t.itemId === source.itemID && normalize(t.raw) === normalize(text) &&
        (!t.langto || /^zh(?:-|$)/i.test(t.langto)));
      if (task?.status === "processing") {
        const deadline = Date.now() + 30000;
        while (task.status === "processing" && Date.now() < deadline) await Z.Promise.delay(100);
        if (task.status === "processing") throw new Error("翻译仍在进行，请完成后再加入");
      }
      if (task?.status === "success" && normalize(task.result)) return task.result;
      const result = await plugin.api.translate(text, {
        pluginID: "zotero-browser@custom.plugin", itemID: source.itemID,
        langfrom: "en", langto: "zh-CN"
      });
      if (result?.status !== "success" || !normalize(result.result)) throw new Error("翻译失败，请重试后再加入");
      return result.result;
    }

    function hasEntry(html, english, chinese) {
      const Parser = Z.getMainWindow().DOMParser;
      const doc = new Parser().parseFromString(html, "text/html");
      return [...doc.querySelectorAll("blockquote")].some(block => {
        const p = block.querySelectorAll("p");
        return p.length >= 2 && normalize(p[0].textContent) === normalize("英文： " + english) &&
          normalize(p[1].textContent) === normalize("中文： " + chinese);
      });
    }

    async function appendEntry(source, english, chinese) {
      const library = Z.Libraries.get(source.libraryID);
      if (!library?.editable) throw new Error("当前资料库为只读，无法保存生词记录");
      const tag = "zotero-browser:vocabulary:" + Z.Utilities.Internal.md5(source.identity);
      const search = new Z.Search();
      search.libraryID = source.libraryID;
      search.addCondition("itemType", "is", "note");
      search.addCondition("tag", "is", tag);
      const ids = await search.search();
      let note = null;
      for (const id of ids) {
        const item = await Z.Items.getAsync(id);
        if (item && !item.deleted && !item.parentID && item.hasTag(tag)) { note = item; break; }
      }
      let html = note ? note.getNote() : "";
      if (note && hasEntry(html, english, chinese)) return { note, duplicate: true };
      if (!note) {
        note = new Z.Item("note");
        note.libraryID = source.libraryID;
        note.addTag(tag, 1);
        note.setCollections(source.collections || []);
        if (source.relatedItem) note.addRelatedItem(source.relatedItem);
        html = '<div data-schema-version="9"><h1>生词与句子 — ' + escape(source.title) + '</h1>' +
          '<p>阅读来源：<a href="' + escape(source.href) + '">' + escape(source.title) + '</a></p></div>';
      }
      const page = source.pageLabel || source.page;
      let href = source.href;
      if (source.page && href.startsWith("zotero://")) href += "?page=" + source.page;
      const entry = '<blockquote><p><strong>英文：</strong> ' + escape(english) + '</p>' +
        '<p><strong>中文：</strong> ' + escape(chinese) + '</p>' +
        '<p><a href="' + escape(href) + '">' + (page ? '第 ' + escape(page) + ' 页' : '阅读来源') + '</a></p></blockquote>';
      // Zotero wraps rich-text notes in an outer schema div. Append inside it,
      // preserving all of the existing editable content.
      html = /<\/div>\s*$/.test(html) ? html.replace(/<\/div>\s*$/, entry + '</div>') : html + entry;
      note.setNote(html);
      await note.saveTx();
      return { note, duplicate: false };
    }

    async function save(source, english, chinese) {
      if (!source?.identity || !source.libraryID) throw new Error("无法识别阅读来源");
      if (!normalize(english) || !normalize(chinese)) throw new Error("原文和中文译文都不能为空");
      const key = source.libraryID + ":" + source.identity;
      // Serialize saves for one PDF to prevent double-clicks and two reader
      // windows from creating two notes or overwriting simultaneous additions.
      const pending = (saves.get(key) || Promise.resolve()).catch(() => {}).then(() => appendEntry(source, english.trim(), chinese.trim()));
      saves.set(key, pending);
      try { return await pending; }
      finally { if (saves.get(key) === pending) saves.delete(key); }
    }

    function addSaveButton(doc, container, source, english, chinese) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "toolbar-button wide-button zb-vocabulary-save";
      button.textContent = "加入生词记录";
      button.title = "将英文原文和中文译文加入当前 PDF 的独立笔记条目";
      button.style.cssText = "width:100%;margin-top:8px;padding:5px 8px;cursor:pointer;";
      const status = doc.createElement("div");
      status.setAttribute("role", "status");
      status.style.cssText = "font-size:12px;line-height:1.5;margin-top:4px;white-space:normal;";
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        button.disabled = true;
        button.textContent = "正在加入…";
        status.textContent = "";
        try {
          const result = await save(source, english, chinese || await translation(source, english));
          button.textContent = result.duplicate ? "已在生词记录中" : "已加入生词记录";
          status.textContent = "可在资料库中打开“生词与句子”笔记。";
        } catch (error) {
          button.disabled = false;
          button.textContent = "重试加入生词记录";
          status.textContent = error.message || String(error);
        }
      });
      container.appendChild(button);
      container.appendChild(status);
      return button;
    }

    function registerReader(pluginID) {
      if (readerHandler || !Z.Reader?.registerEventListener) return;
      readerHandler = event => {
        const text = String(event.params?.annotation?.text || "").trim();
        if (!/[A-Za-z]/.test(text) || !Z.PDFTranslate?.api?.translate) return;
        try {
          // Capture the source NOW; switching tabs while translation is in
          // flight must never route the saved words to the newly active PDF.
          const source = readerSource(event.reader, event.params.annotation);
          const container = event.doc.createElement("div");
          container.className = "zb-vocabulary-controls";
          addSaveButton(event.doc, container, source, text);
          event.append(container);
        } catch (error) { Z.debug("[Zotero Browser] vocabulary: " + error); }
      };
      Z.Reader.registerEventListener("renderTextSelectionPopup", readerHandler, pluginID);
    }

    function unregisterReader() {
      if (readerHandler) Z.Reader.unregisterEventListener("renderTextSelectionPopup", readerHandler);
      readerHandler = null;
    }

    return { readerSource, previewSource, translation, save, addSaveButton, registerReader, unregisterReader };
  }

  return { createService, normalize };
})();
if (typeof module === "object" && module.exports) module.exports = zbVocabulary;
