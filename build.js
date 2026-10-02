/** Package the Zotero plugin with its license and privacy notices. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const manifest = require('./manifest.json');
const pkg = require('./package.json');
const output = path.join(__dirname, 'zotero-browser.xpi');
const files = ['manifest.json', 'bootstrap.js', 'chrome.manifest', 'content', 'locale',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md'];
if (manifest.version !== pkg.version) throw new Error('Manifest/package versions differ');
for (const file of files) if (!fs.existsSync(path.join(__dirname, file))) throw new Error('Missing package file: ' + file);
if (fs.existsSync(output)) fs.unlinkSync(output);
execFileSync('zip', ['-r', '-q', '-9', output, ...files, '-x', '*.DS_Store', '*__MACOSX*'],
  { cwd: __dirname, stdio: 'inherit' });
execFileSync('unzip', ['-tq', output], { stdio: 'inherit' });
console.log(`Built ${path.basename(output)} (${(fs.statSync(output).size / 1024 / 1024).toFixed(2)} MB), version ${manifest.version}`);
