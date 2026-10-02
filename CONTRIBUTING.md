# Contributing

Use Node.js 22 or newer and Git. Tests have no external Node dependencies:

```sh
npm test
npm run build
```

The build currently uses the system `zip` executable (available on macOS and
Ubuntu; install a compatible zip utility for other environments). Use a separate
Zotero profile and data directory for development. Avoid testing against a real
library when creating or deleting records.

Preserve these interaction rules: Cite opens only on explicit activation; Cite
is an internal popup; bilingual vocabulary records are scoped to their source
PDF and kept separate from Cite; copying a PDF copies the local file object and
is offered in the PDF reader; collapsing the dock fully hides it and preserves
its browser instance.

Report reproducible issues with plugin/Zotero versions, OS, exact steps and
expected/actual behavior. Remove private data. Existing UI is primarily Chinese;
localization improvements are welcome. New code should use the existing
JavaScript style and focused tests for behavior changes.

For release steps and validation limits, see docs/RELEASE_CHECKLIST.md.
