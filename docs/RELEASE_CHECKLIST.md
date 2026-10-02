# Release checklist and validation status

## 0.0.1 public pre-release

- Local automated tests: run with `npm test`; no real library writes or Cookie reads.
- XPI build: `npm run build`; package includes root MIT license, privacy notice,
  third-party notice and original PDF.js/font/CMap licenses; archive integrity checked.
- Release assets: versioned XPI, `SHA256SUMS.txt` and `updates.json` with matching hash.
- Supported installation range: Zotero 9.0.x only. Existing plugin ID is preserved
  to permit upgrades; owner/repository URLs point to Wfssll/zotero-browser.
- Platform evidence: macOS + Zotero 9.0.6 read-only API/DOM probes for source
  resolution, popup integration, PDF clipboard transfer object, native fullZoom
  interface and CSS zoom support. Skin components inspected in a browser preview.
- **Not complete**: installing the final 0.0.1 XPI and exercising every workflow;
  Windows/Linux; individual chat-app PDF pastes; Zotero 7/8/10.

## Before a stable release

Use a separate test profile/data directory. Record OS and Zotero version for each:

- [ ] Install/update/disable/re-enable/uninstall; no leftover dock, listeners or timers.
- [ ] Browse/search/open PDF/switch tabs; collapse and restore without lost state.
- [ ] Manual Cite from browser and current Zotero reader; no automatic popup/query.
- [ ] ADS exact match, missing/ambiguous match, Token errors, quota stop, cancellation.
- [ ] Save/read/update independent Cite note; batch collection, library and retry.
- [ ] Bilingual note creation, append/deduplication, source binding and read-only library.
- [ ] Copy actual local PDF; unavailable file feedback; paste into selected receiving apps.
- [ ] Zoom home/web/PDF; reset/bounds/tab isolation; remote content and focus behavior.
- [ ] Theme contrast, background preview/apply, narrow window, import/remove/error handling.
- [ ] Save during tab switching; attachment download failure; collection destination.
- [ ] Verify Windows/Linux host UI and file picker behavior before claiming support.

## Publishing

1. Update manifest/package versions together; update CHANGELOG and tested range.
2. Run tests/build/release assets; review privacy/license notices and staged files.
3. Create a tagged GitHub pre-release with XPI, checksum and update-manifest assets.
4. Keep root `updates.json` empty for the first pre-release so it is opt-in.
5. For a stable release, use Publish release with prerelease disabled. The workflow
   publishes assets and commits the hash-bearing stable update manifest to main.
6. If stable update publication fails, correct and publish the manifest before
   claiming automatic updates work. Never repoint an existing release asset to a
   different package without updating its checksum.

Longer-term work: duplicate import handling, translator integration, persisted ADS
batch progress/quota-header scheduling, session restoration, measured idle-tab
suspension, localization and gradual module extraction. These are not features
of the first public pre-release.
