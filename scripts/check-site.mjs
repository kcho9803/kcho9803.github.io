import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Check a real Jekyll build, including assets and any newly added blog posts.
const root = path.resolve(process.argv[2] || '_site');
assert(existsSync(root), 'Build the site before running this check.');
const origin = 'https://kcho9803.github.io';
const required = ['index.html', 'publications/index.html', 'writing/index.html',
  'teaching/index.html', 'teaching/em-wave-3d/index.html', 'cv/index.html', '404.html',
  'sitemap.xml', 'feed.xml', 'assets/css/main.css'];
for (const file of required) assert(existsSync(path.join(root, file)), `Missing ${file}`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

let links = 0;
const errors = [];
const files = walk(root);
for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (/^(?:docs|scripts|private|_private|_drafts|node_modules|vendor)\//.test(relative)
      || /(?:^|\/)(?:README\.md|Gemfile(?:\.lock)?|\.env(?:\..*)?)$/.test(relative)) {
    errors.push(`Non-site source in output: ${relative}`);
  }
  if (!/\.(?:html|xml|json|css)$/.test(file)) continue;
  const content = readFileSync(file, 'utf8');
  if (/Paper Title Number|Blog Post number|GitHub University|Portfolio item number|2199-01-01|kcho9803@gist\.ac\.kr/i.test(content)) {
    errors.push(`Template or stale profile content in ${relative}`);
  }
  if (/C:[\\/]+Users[\\/]|file:\/\//i.test(content)) errors.push(`Local path in ${relative}`);
  if (/\{%|\{\{/.test(content) && file.endsWith('.html')) errors.push(`Unrendered Liquid in ${relative}`);
  if (!file.endsWith('.html')) continue;
  for (const match of content.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    if (/\.xml(?:[?#]|$)/i.test(match[1])) errors.push(`XML page linked from ${relative}: ${match[1]}`);
  }
  for (const match of content.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const raw = match[1].replaceAll('&amp;', '&');
    if (/^(?:#|mailto:|tel:|data:|javascript:)/i.test(raw)) continue;
    const pageUrl = new URL('/' + relative, origin);
    const url = new URL(raw, pageUrl);
    if (url.origin !== origin) continue;
    links++;
    let target = path.join(root, decodeURIComponent(url.pathname));
    if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!existsSync(target)) errors.push(`Broken local link in ${relative}: ${raw}`);
  }
}

const home = readFileSync(path.join(root, 'index.html'), 'utf8');
assert(home.includes('Local decoding for quantum error correction') && home.includes('Purdue University'), 'Missing current profile.');
assert(home.includes('topological quantum memories') && home.includes('toric code'), 'Missing local decoding research focus.');
assert.equal(errors.length, 0, errors.join('\n'));
console.log(`Passed: ${files.length} generated files, ${links} local links/assets, current profile, and template/source exclusions.`);
