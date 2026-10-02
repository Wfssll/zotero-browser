/** Create downloadable release files and a Mozilla-style update manifest. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
if (pkg.version !== manifest.version) throw new Error('Manifest/package versions differ');
const tag = process.env.RELEASE_TAG || 'v' + manifest.version;
if (tag !== 'v' + manifest.version) throw new Error('Release tag must match manifest version');
const repo = process.env.GITHUB_REPOSITORY || 'Wfssll/zotero-browser';
const directory = path.join(root, 'dist');
fs.mkdirSync(directory, { recursive: true });
const filename = `zotero-browser-${manifest.version}.xpi`;
const data = fs.readFileSync(path.join(root, 'zotero-browser.xpi'));
const hash = crypto.createHash('sha256').update(data).digest('hex');
fs.writeFileSync(path.join(directory, filename), data);
fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), `${hash}  ${filename}\n`);
const { id, strict_min_version, strict_max_version } = manifest.applications.zotero;
const update = { addons: { [id]: { updates: [{ version: manifest.version,
  update_link: `https://github.com/${repo}/releases/download/${tag}/${filename}`,
  update_hash: 'sha256:' + hash,
  applications: { zotero: { strict_min_version, strict_max_version } }
}] } } };
fs.writeFileSync(path.join(directory, 'updates.json'), JSON.stringify(update, null, 2) + '\n');
console.log(`Release assets: dist/${filename}, SHA256SUMS.txt, updates.json`);
