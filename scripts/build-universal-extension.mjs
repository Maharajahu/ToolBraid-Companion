import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const PUBLIC_OUTPUT = path.join(PROJECT_ROOT, 'dist', 'toolbraid-extension');
const PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkUP7t3TZSIcrCg6Blei+Awe9kgnf7eTIwDIkwv6dFiQX882eZE+p2XfjKsUgioHF+G+mckRcXlb8kh/PYO+MIP1xxImklWflzwmlS1rVEpW+E3IyVZsh/JGbZypzmRh7OgeMsz2+u4bh5A+J4DTvq6pHn6ZQZyOQ9SA6We5V3EN9g4MNrp0mIywQh+BGJKb5ZL7qRUu8kNDZJW/fr8RYbxqlsMD0a/i/Og+KCF/2BmWyMLIZchJietVw0PAuVSFgk+L0U9GEuZ19zVTg9iZdQ3ylKq0DP21KTmZnjP9HkHklczN2jbL59XWkbHGyUbnZaGQtLE0QXcp0iO7OgN3EjQIDAQAB';

async function removeLegacyCloudSurface(targetDir) {
  for (const relative of [
    ['src', 'app'],
    ['src', 'packs', 'recovery'],
    ['src', 'providers'],
    ['src', 'site-adapters', 'github.js'],
    ['src', 'site-adapters', 'vercel.js'],
    ['src', 'site-adapters', 'index.js'],
  ]) {
    await rm(path.join(targetDir, ...relative), { recursive: true, force: true });
  }
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

async function assertPublicBuild(targetDir, manifest) {
  for (const field of ['content_scripts', 'externally_connectable', 'update_url']) {
    if (field in manifest) throw new Error(`Public extension build contains forbidden manifest field: ${field}`);
  }
  if (!manifest.permissions?.includes('downloads')) throw new Error('Public extension build lacks downloads permission.');
  if (!manifest.permissions?.includes('debugger') || manifest.optional_permissions?.includes('debugger')) throw new Error('Debugger must be a required manifest permission; Chrome does not allow it as optional.');

  for (const relative of [
    path.join('src', 'app'),
    path.join('src', 'packs', 'recovery'),
    path.join('src', 'providers'),
    path.join('src', 'site-adapters', 'github.js'),
    path.join('src', 'site-adapters', 'vercel.js'),
    path.join('src', 'site-adapters', 'index.js'),
  ]) {
    try {
      await stat(path.join(targetDir, relative));
      throw new Error(`Public extension build retained legacy surface: ${relative}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const moduleFiles = (await listFiles(targetDir)).filter((relative) => relative.endsWith('.js'));
  const forbiddenImport = /(?:from\s+['"][^'"]*site-adapters\/(?:index|github|vercel)\.js['"]|import\(\s*['"][^'"]*site-adapters\/(?:index|github|vercel)\.js['"]|create(?:GitHub|Vercel)Adapter)/;
  for (const relative of moduleFiles) {
    const source = await readFile(path.join(targetDir, relative), 'utf8');
    if (forbiddenImport.test(source)) {
      throw new Error(`Public extension module graph imports a legacy adapter: ${relative}`);
    }
  }
}

function assertBuildTarget(outputDir) {
  const distRoot = path.resolve(PROJECT_ROOT, 'dist');
  const resolved = path.resolve(outputDir);
  if (resolved === distRoot || !resolved.startsWith(`${distRoot}${path.sep}`)) {
    throw new Error(`Extension output must stay inside ${distRoot}`);
  }
  return resolved;
}

function rewriteExtensionModule(source) {
  // Source modules live under extension/, while the unpacked build flattens
  // them beside manifest.json. Keep the source tree easy to test and rewrite
  // only imports that cross into src/.
  return source
    .replaceAll("from '../src/", "from './src/")
    .replaceAll('from "../src/', 'from "./src/')
    .replaceAll("import('../src/", "import('./src/")
    .replaceAll('import("../src/', 'import("./src/');
}

async function rewriteExtensionModules(sourceDir, targetDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await rewriteExtensionModules(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name) !== '.js') continue;
    const source = await readFile(targetPath, 'utf8');
    const rewritten = rewriteExtensionModule(source);
    if (rewritten !== source) await writeFile(targetPath, rewritten, 'utf8');
  }
}

export async function buildUniversalExtension({ outputDir, edition = 'public' } = {}) {
  if (edition !== 'public') throw new Error('This repository builds the public edition only.');
  const target = assertBuildTarget(outputDir ?? PUBLIC_OUTPUT);
  const extensionSource = path.join(PROJECT_ROOT, 'extension');
  const srcSource = path.join(PROJECT_ROOT, 'src');

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(extensionSource, target, { recursive: true });
  await cp(srcSource, path.join(target, 'src'), { recursive: true });

  await rewriteExtensionModules(extensionSource, target);
  await removeLegacyCloudSurface(target);

  const manifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'));
  if (edition === 'public') {
    await cp(path.join(PROJECT_ROOT, 'LICENSE'), path.join(target, 'LICENSE'));
    const pkg = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    Object.assign(manifest, {
      name: 'ToolBraid', version: pkg.version, key: PUBLIC_KEY,
      description: 'WebMCP-enabled browser tools, ChatGPT-account chat through Codex, and X community workflows for developers.',
      action: { ...manifest.action, default_title: 'Connect ToolBraid' },
    });
    await writeFile(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(target, 'product.js'), "export const PUBLIC_RELEASE = true;\nexport const NATIVE_MCP_HOST = 'com.toolbraid.bridge';\n");
    const panelPath = path.join(target, 'sidepanel.html');
    const panel = await readFile(panelPath, 'utf8');
    await writeFile(panelPath, panel.replace('<title>ToolBraid Abliterated</title>', '<title>ToolBraid</title>').replace('<h1>Abliterated</h1>', '<h1>Browser tools</h1>').replace('>Owner Autonomy</h2>', '>AI control</h2>'));
    const privacy = (await readFile(path.join(PROJECT_ROOT, 'release', 'PRIVACY.md'), 'utf8')).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    await writeFile(path.join(target, 'privacy.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ToolBraid data handling</title><link rel="stylesheet" href="sidepanel.css"></head><body><main class="app-shell"><pre class="privacy-copy">${privacy}</pre></main></body></html>\n`);
  }
  if (manifest.manifest_version !== 3 || manifest.background?.type !== 'module') {
    throw new Error('Universal extension build requires a Manifest V3 module service worker.');
  }
  await assertPublicBuild(target, manifest);

  const buildMetadata = {
    product: manifest.name,
    edition,
    version: manifest.version,
    manifestVersion: manifest.manifest_version,
    generatedAt: new Date().toISOString(),
    loadUnpackedDirectory: target,
  };
  await writeFile(
    path.join(target, 'build-metadata.json'),
    `${JSON.stringify(buildMetadata, null, 2)}\n`,
    'utf8',
  );
  return Object.freeze(buildMetadata);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const editionIndex = process.argv.indexOf('--edition');
  const metadata = await buildUniversalExtension({ edition: editionIndex < 0 ? 'public' : process.argv[editionIndex + 1] });
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
}
