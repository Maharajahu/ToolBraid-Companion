import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const canonical = 'https://github.com/Maharajahu/ToolBraid-Companion';
const documents = new Map();

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.name.endsWith('.md')) {
      const text = await readFile(full, 'utf8');
      const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
      const ids = new Set([...prose.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
      const headings = new Map();
      for (const [, title] of prose.matchAll(/^#{1,6} (.+)$/gm)) {
        const slug = title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
        const count = headings.get(slug) ?? 0;
        headings.set(slug, count + 1);
        ids.add(count ? `${slug}-${count}` : slug);
      }
      documents.set(full, { text, prose, ids });
    }
  }
}

await walk(root);
let links = 0;
for (const [file, { text, prose }] of documents) {
  const name = path.relative(root, file);
  assert.ok(!text.includes('https://github.com/Maharajahu/toolbraid-releases'), `${name}: obsolete repository URL`);
  assert.doesNotMatch(text, /(?:[A-Z]:[\\/]Users[\\/]|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{30,}|ghp_[A-Za-z0-9]{30,})/, `${name}: possible private data`);
  const refs = [
    ...[...prose.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map(match => match[1]),
    ...[...prose.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(match => match[1]),
  ];
  for (const ref of refs) {
    if (/^(?:https?:|mailto:)/.test(ref)) continue;
    const [target, fragment] = ref.split('#');
    const full = target ? path.resolve(path.dirname(file), decodeURIComponent(target)) : file;
    const relative = path.relative(root, full);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), `${name}: link outside repository: ${ref}`);
    assert.ok((await stat(full)).isFile(), `${name}: missing file: ${ref}`);
    if (fragment) assert.ok(documents.get(full)?.ids.has(decodeURIComponent(fragment)), `${name}: missing anchor: ${ref}`);
    links++;
  }
  for (const [tag] of prose.matchAll(/<img\b[^>]*>/g)) assert.match(tag, /\balt="[^"]+"/, `${name}: image needs alt text`);
}

const manifest = (await readFile(path.join(root, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/);
const expected = [
  'ToolBraid-0.3.1-extension.zip',
  'ToolBraid-0.3.1-edge-extension.zip',
  'ToolBraid-0.3.1-windows-x64.zip',
  'ToolBraid-Windows-real-demo-4K.mp4',
].sort();
for (const line of manifest) assert.match(line, /^[a-f0-9]{64}  [A-Za-z0-9._-]+$/, 'Invalid checksum-list entry');
assert.deepEqual(manifest.map(line => line.slice(66)).sort(), expected, 'Unexpected or duplicate release asset');

const readme = documents.get(path.join(root, 'README.md')).text;
assert.match(readme, /<h1 align="center">ToolBraid Companion<\/h1>/);
assert.ok(readme.includes(`${canonical}/releases/download/v0.3.1-rc.1/ToolBraid-0.3.1-windows-x64.zip`));
assert.ok(readme.includes('\nhttps://github.com/user-attachments/assets/5696a89b-59d6-4fd8-ad80-023f04fb16b7\n'), 'Keep the native video embed');
console.log(`PASS: ${documents.size} documents, ${links} local links/anchors, image references and 4 checksum-list entries. No application/runtime tests were run.`);
