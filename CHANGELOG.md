# Changelog

## 0.0.2 — Safari Cookie import fix

- Use Zotero’s current FilePicker wrapper so selecting a Safari Cookie file works on current Gecko.
- Accept cross-global Uint8Array/ArrayBuffer data returned by IOUtils; preserve byte offsets.
- Check actual file readability, distinguish macOS access denial from missing/invalid files, and show persistent permission guidance.
- Preserve manually selected files and the selected source when re-detecting; enable import after access becomes available.
- System authorization remains required for protected Safari data. A readable copy can be selected instead. The plugin does not bypass macOS privacy controls.
- 82 automated tests pass. Installed-package testing in macOS Zotero 9.0.6 confirms the native file picker, file validation and one-cookie domain-scoped import into Zotero’s cookie store using a synthetic file without login credentials.

## 0.0.1 — First public pre-release

- Multi-tab academic browser with a persistent, collapsible Zotero dock.
- Manual NASA ADS Cite popup, complete BibTeX copying/export and batch Cite notes.
- PDF-specific bilingual vocabulary notes and reader-only local PDF file copying.
- Home search, ten interface palettes, eight local landscape backgrounds, image
  import and staged background previews.
- Command/Ctrl + plus/minus/0 zoom for the active home, webpage or PDF tab.
- Fix generic-page saves using the title and URL captured before the destination
  picker, even when another tab becomes active while it is open.
- Limit installation to Zotero 9.0.x; broader compatibility needs real testing.
- Add licensing, privacy information, CI, release packaging and SHA-256 checksums.

This is an early public release. Automated checks and macOS Zotero 9.0.6 API/UI
probes have been performed; complete installed-package workflows and Windows/Linux
have not yet been validated. See docs/RELEASE_CHECKLIST.md.
