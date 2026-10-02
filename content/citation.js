/* ADS-backed citation retrieval and independent Cite notes. No local BibTeX fallback. */
var zbCitation = (() => {
  const escapeHTML = text => String(text || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const normalizeTitle = text => String(text || "").normalize("NFKC").replace(/[{}]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const quote = text => '"' + String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  const ARXIV = /^(\d{4}\.\d{4,5}|[a-z][a-z.\-]*\/\d{7})(?:v\d+)?(?:\.pdf)?$/i;

  function arxivID(value) {
    let text = String(value || "").trim();
    if (/^https?:\/\//i.test(text)) {
      const url = text.match(/^https?:\/\/((?:export\.)?arxiv\.org)\/(?:pdf|abs|html)\/([^?#]+)/i);
      if (!url) return null;
      try { text = decodeURIComponent(url[2]).replace(/\/$/, ""); } catch (_) { return null; }
    } else text = text.replace(/^arxiv\s*:\s*/i, "");
    return text.match(ARXIV)?.[1] || null;
  }

  function doiID(value) {
    return String(value || "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").match(/^(10\.\d{4,9}\/\S+)$/i)?.[1] || null;
  }

  function adsBibcode(value) {
    const url = String(value || "").match(/^https?:\/\/(?:ui\.|www\.)?adsabs\.harvard\.edu\/abs\/([^/?#]+)/i);
    if (!url) return null;
    try {
      const code = decodeURIComponent(url[1]);
      return /^[12]\d{3}\S{15}$/.test(code) ? code : null;
    } catch (_) { return null; }
  }

  function sourceFromURL(url, libraryID, collections = []) {
    const arxiv = arxivID(url), doi = doiID(url), bibcode = adsBibcode(url);
    if (!arxiv && !doi && !bibcode) throw new Error("请输入 arXiv PDF／摘要链接、DOI 或 ADS 文章链接");
    return { arxiv, doi, bibcode, url, libraryID, collections,
      identity: arxiv ? "arxiv:" + arxiv : doi ? "doi:" + doi.toLowerCase() : "ads:" + bibcode,
      title: arxiv ? "arXiv:" + arxiv : doi || bibcode };
  }

  function createService(Z, options = {}) {
    let guest = null, guestPending = null;
    const cache = new Map(), pending = new Map(), saves = new Map();
    const request = options.request || (async (method, url, config = {}) => {
      try {
        const response = await Z.HTTP.request(method, url, {
          responseType: "json", timeout: 30000, successCodes: false,
          headers: config.headers || {}, body: config.body
        });
        return { status: response.status, data: response.response };
      } catch (_) { throw new Error("ADS 网络请求失败，请检查网络后重试"); }
    });
    const getToken = options.getToken || (() => "");

    async function authentication() {
      const token = getToken();
      if (token) return { token, base: "https://api.adsabs.harvard.edu/v1", personal: true };
      if (guest && guest.expires > Date.now() + 60000) return guest;
      if (!guestPending) guestPending = (async () => {
        const response = await request("GET", "https://ui.adsabs.harvard.edu/v1/accounts/bootstrap");
        if (response.status !== 200 || !response.data?.access_token) {
          throw Object.assign(new Error(response.status === 429 ?
            "ADS 访客请求额度已用尽；请稍后重试或配置个人 API Token" :
            "ADS 访客会话不可用；可在 Cite 设置中填写个人 ADS API Token"), { fatal: true });
        }
        guest = { token: response.data.access_token, base: "https://ui.adsabs.harvard.edu/v1",
          expires: Number(response.data.expires_at) * 1000 || Date.now() + 600000 };
        return guest;
      })().finally(() => { guestPending = null; });
      return guestPending;
    }

    async function api(method, path, body, retry = true) {
      const auth = await authentication();
      const response = await request(method, auth.base + path, {
        headers: { Authorization: "Bearer " + auth.token, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      });
      if (response.status === 401 && !auth.personal && retry) {
        guest = null;
        return api(method, path, body, false);
      }
      if (response.status === 401 || response.status === 403) throw Object.assign(new Error("ADS 授权失败，请检查 Cite 设置中的 Token 或稍后重试"), { fatal: true });
      if (response.status === 429) throw Object.assign(new Error("ADS 请求额度已用尽；批量任务已暂停，请稍后重试或配置个人 API Token"), { fatal: true });
      if (response.status < 200 || response.status >= 300) throw new Error("ADS 服务返回 HTTP " + response.status + "，请稍后重试");
      return response.data;
    }

    function itemSource(item) {
      if (item.parentID) item = Z.Items.get(item.parentID);
      if (!item || item.deleted || !item.isRegularItem()) throw new Error("请选择文献条目；独立笔记和附件不作为文章导出");
      const field = name => { try { return item.getField(name) || ""; } catch (_) { return ""; } };
      const url = field("url"), extra = field("extra");
      const arxiv = arxivID(url) || arxivID(field("archiveLocation")) ||
        arxivID(extra.match(/(?:^|\n)\s*(?:arxiv(?:\s*id)?|eprint)\s*:\s*([^\s]+)/i)?.[1]);
      const doi = doiID(field("DOI")) || doiID(extra.match(/(?:^|\n)\s*doi\s*:\s*(\S+)/i)?.[1]);
      const bibcode = adsBibcode(url) || extra.match(/(?:^|\n)\s*(?:ADS\s*)?bibcode\s*:\s*([12]\d{3}\S{15})/i)?.[1];
      return { item, itemID: item.id, libraryID: item.libraryID, identity: "item:" + item.key,
        title: field("title"), url, arxiv, doi, bibcode, collections: item.getCollections() };
    }

    async function findRecord(source) {
      const attempts = [];
      if (source.bibcode) attempts.push({ q: "bibcode:" + quote(source.bibcode), matches: d => d.bibcode === source.bibcode });
      if (source.arxiv) attempts.push({ q: "identifier:" + quote("arXiv:" + source.arxiv),
        matches: d => (d.identifier || []).some(id => arxivID(id) === source.arxiv) });
      if (source.doi) attempts.push({ q: "doi:" + quote(source.doi),
        matches: d => [...(d.doi || []), ...(d.identifier || [])].some(id => doiID(id)?.toLowerCase() === source.doi.toLowerCase()) });
      if (source.item && source.title) attempts.push({ q: "title:" + quote(source.title),
        matches: d => (d.title || []).some(title => normalizeTitle(title) === normalizeTitle(source.title)) });
      if (!attempts.length) throw new Error("条目缺少 DOI、arXiv 编号和标题，无法查询 ADS");
      for (const attempt of attempts) {
        const data = await api("GET", "/search/query?q=" + encodeURIComponent(attempt.q) +
          "&fl=bibcode,title,identifier,doi&rows=25");
        if (!data?.response || !Array.isArray(data.response.docs)) throw new Error("ADS 查询返回了无效结果");
        if (data.response.numFound > 25) throw new Error("ADS 匹配结果过多，请补充 DOI 或 arXiv 编号后重试");
        const records = data.response.docs.filter(attempt.matches);
        if (records.length > 1) throw new Error("ADS 找到多个匹配记录，请使用具体 ADS 文章链接获取，避免保存错误引用");
        if (records.length === 1) return records[0];
      }
      throw new Error("ADS 尚未收录或未找到精确匹配的文章");
    }

    function validateBibtex(text, bibcode) {
      // ADS default keys are bibcodes. Reject an empty/error/wrong-record
      // response instead of saving it as if it were a valid citation.
      const entry = String(text || "").match(/^\s*@([a-z]+)\s*\{([^,\s]+),[\s\S]*\}\s*$/i);
      if (!entry || entry[2] !== bibcode || (String(text).match(/^\s*@\w+\s*\{/gm) || []).length !== 1) {
        throw new Error("ADS BibTeX 导出为空或与所选文章不匹配");
      }
      return text;
    }

    function noteTag(source) { return "zotero-browser:cite:" + Z.Utilities.Internal.md5(source.identity); }
    async function findNote(source) {
      const search = new Z.Search(); search.libraryID = source.libraryID;
      search.addCondition("itemType", "is", "note"); search.addCondition("tag", "is", noteTag(source));
      for (const id of await search.search()) {
        const note = await Z.Items.getAsync(id);
        if (note && !note.deleted && !note.parentID && note.hasTag(noteTag(source))) return note;
      }
      return null;
    }

    async function stored(source) {
      const note = await findNote(source);
      if (!note) return null;
      const Parser = Z.getMainWindow().DOMParser;
      const doc = new Parser().parseFromString(note.getNote(), "text/html");
      const bibtex = doc.querySelector("pre")?.textContent;
      const bibcode = adsBibcode(doc.querySelector('a[href*="adsabs.harvard.edu/abs/"]')?.getAttribute("href"));
      if (!bibcode || !bibtex) return null;
      const identity = JSON.stringify([source.arxiv || "", source.doi || "", source.bibcode || "", source.item ? normalizeTitle(source.title) : ""]);
      const metadata = [...doc.querySelectorAll("p")].find(p => p.textContent.startsWith("匹配标识："));
      if (!metadata || metadata.textContent.slice("匹配标识：".length) !== identity) return null;
      try { validateBibtex(bibtex, bibcode); } catch (_) { return null; }
      const fetched = [...doc.querySelectorAll("p")].find(p => p.textContent.startsWith("获取时间："));
      return { bibtex, bibcode, title: doc.querySelector("h1")?.textContent.replace(/^Cite — /, "") || source.title,
        fetchedAt: fetched?.textContent.slice("获取时间：".length),
        adsURL: "https://ui.adsabs.harvard.edu/abs/" + encodeURIComponent(bibcode), saved: true };
    }

    async function retrieve(source, refresh = false) {
      const key = [source.libraryID, source.identity, source.arxiv, source.doi, source.bibcode, source.title].join(":");
      if (!refresh && cache.has(key)) return cache.get(key);
      if (pending.has(key)) return pending.get(key);
      const job = (async () => {
        if (!refresh && source.libraryID) {
          const saved = await stored(source);
          if (saved) { cache.set(key, saved); return saved; }
        }
        const record = await findRecord(source);
        const data = await api("POST", "/export/bibtex", { bibcode: [record.bibcode], maxauthor: 0, sort: "no sort" });
        const result = { bibtex: validateBibtex(data?.export, record.bibcode), bibcode: record.bibcode,
          title: record.title?.[0] || source.title, adsURL: "https://ui.adsabs.harvard.edu/abs/" + encodeURIComponent(record.bibcode),
          fetchedAt: new Date().toISOString() };
        cache.set(key, result);
        return result;
      })();
      pending.set(key, job);
      try { return await job; } finally { if (pending.get(key) === job) pending.delete(key); }
    }

    async function save(source, result) {
      validateBibtex(result.bibtex, result.bibcode);
      if (!Z.Libraries.get(source.libraryID)?.editable) throw new Error("当前资料库为只读，无法保存 Cite 笔记");
      const key = source.libraryID + ":" + source.identity;
      const job = (saves.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
        let note = await findNote(source);
        const created = !note;
        if (!note) {
          note = new Z.Item("note"); note.libraryID = source.libraryID;
          note.addTag(noteTag(source), 1); note.setCollections(source.collections || []);
          if (source.item) note.addRelatedItem(source.item);
        }
        const identity = JSON.stringify([source.arxiv || "", source.doi || "", source.bibcode || "", source.item ? normalizeTitle(source.title) : ""]);
        const html = '<div data-schema-version="9"><h1>Cite — ' + escapeHTML(result.title || source.title) + '</h1>' +
          '<p>来源：NASA ADS · <a href="' + escapeHTML(result.adsURL) + '">' + escapeHTML(result.bibcode) + '</a></p>' +
          '<p>获取时间：' + escapeHTML(result.fetchedAt || "已保存的 ADS 引用") + '</p>' +
          '<p>匹配标识：' + escapeHTML(identity) + '</p><pre>' + escapeHTML(result.bibtex) + '</pre></div>';
        if (created) note.setNote(html);
        else {
          // Refresh only the generated fields, retaining text the user added
          // alongside the citation in Zotero's ordinary note editor.
          const Parser = Z.getMainWindow().DOMParser;
          const doc = new Parser().parseFromString(note.getNote(), "text/html");
          const pre = doc.querySelector("pre");
          if (pre) {
            pre.textContent = result.bibtex;
            const heading = doc.querySelector("h1"); if (heading) heading.textContent = "Cite — " + (result.title || source.title);
            const link = doc.querySelector('a[href*="adsabs.harvard.edu/abs/"]');
            if (link) { link.textContent = result.bibcode; link.setAttribute("href", result.adsURL); }
            for (const p of doc.querySelectorAll("p")) {
              if (p.textContent.startsWith("获取时间：")) p.textContent = "获取时间：" + (result.fetchedAt || "已保存的 ADS 引用");
              if (p.textContent.startsWith("匹配标识：")) p.textContent = "匹配标识：" + identity;
            }
            note.setNote(doc.body.innerHTML);
          } else note.setNote(note.getNote() + html);
        }
        await note.saveTx();
        return { note, created };
      });
      saves.set(key, job);
      try { return await job; } finally { if (saves.get(key) === job) saves.delete(key); }
    }

    async function targets(scope, pane, recursive = true) {
      let items;
      const libraryID = pane.getSelectedLibraryID();
      if (scope === "selected") items = pane.getSelectedItems();
      else if (scope === "collection") {
        const collection = pane.getSelectedCollection();
        if (!collection) throw new Error("请先在 Zotero 左侧选择一个分类文件夹");
        const collections = [collection];
        if (recursive) collections.push(...collection.getDescendents(false, "collection", false).map(c => Z.Collections.get(c.id)));
        items = collections.flatMap(c => c.getChildItems(false));
      } else if (scope === "library") items = await Z.Items.getAll(libraryID, true, false);
      else throw new Error("未知批量范围");
      const seen = new Set();
      return items.map(item => item.parentID ? Z.Items.get(item.parentID) : item).filter(item => {
        if (!item || item.deleted || !item.isRegularItem() || seen.has(item.id)) return false;
        seen.add(item.id); return true;
      }).map(itemSource);
    }

    async function batch(sources, options = {}) {
      const report = { total: sources.length, completed: [], failed: [], cancelled: false, stopped: false };
      for (let index = 0; index < sources.length; index++) {
        if (options.cancelled?.()) { report.cancelled = true; break; }
        const source = sources[index];
        options.onProgress?.({ index, total: sources.length, source, report });
        try {
          const result = await retrieve(source, options.refresh);
          if (options.cancelled?.()) { report.cancelled = true; break; }
          const saved = options.save === false ? null : await save(source, result);
          report.completed.push({ source, result, saved });
        } catch (error) {
          report.failed.push({ source, error: error.message });
          if (error.fatal) { report.stopped = true; break; }
        }
        options.onProgress?.({ index: index + 1, total: sources.length, source, report });
        if (index + 1 < sources.length) await Z.Promise.delay(350);
      }
      return report;
    }

    function combine(results) {
      const seen = new Set();
      return results.filter(result => !seen.has(result.bibcode) && seen.add(result.bibcode)).map(r => r.bibtex.trim()).join("\n\n") + (results.length ? "\n" : "");
    }
    return { itemSource, retrieve, save, targets, batch, combine, stored, previewSource: sourceFromURL };
  }
  return { createService, arxivID, doiID, adsBibcode, sourceFromURL };
})();
if (typeof module === "object" && module.exports) module.exports = zbCitation;
