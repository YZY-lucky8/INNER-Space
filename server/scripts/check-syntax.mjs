import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.resolve(here, '../src'), path.resolve(here, '../../src')];

async function walk(dir, out = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'vendor', 'assets'].includes(e.name)) continue;
      await walk(full, out);
    } else if (/\.(js|mjs)$/.test(e.name)) {
      out.push(full);
    } else if (/\.html$/.test(e.name) && e.name === 'index.html') {
      out.push(full);
    }
  }
  return out;
}

/** 对 HTML 文件抽取内联 <script> 体做语法检查 */
async function checkHtml(file) {
  const html = await fs.readFile(file, 'utf8');
  const bodies = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]).filter((s) => s.trim());
  for (const [i, body] of bodies.entries()) {
    const tmp = path.join(here, `.check-${path.basename(file)}-${i}.mjs`);
    await fs.writeFile(tmp, body, 'utf8');
    try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
    finally { await fs.rm(tmp, { force: true }); }
  }
  return bodies.length;
}

let checked = 0;
let failed = 0;
for (const root of roots) {
  for (const file of await walk(root)) {
    try {
      if (file.endsWith('.html')) {
        const n = await checkHtml(file);
        console.log(`OK   ${path.relative(here, file)} (${n} 段内联脚本)`);
      } else {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        console.log(`OK   ${path.relative(here, file)}`);
      }
      checked++;
    } catch (err) {
      failed++;
      console.error(`FAIL ${path.relative(here, file)}`);
      console.error(String(err?.stderr || err?.message).slice(0, 1200));
    }
  }
}
console.log(`\n语法检查：${checked} 个文件通过，${failed} 个失败`);
process.exit(failed ? 1 : 0);
