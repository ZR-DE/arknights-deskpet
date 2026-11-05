'use strict';

/**
 * 把解包的时装素材导入 assets/character/。
 *
 * 为什么要改名而不是原样拷进去：
 * 原始文件名带 `#`（build_char_002_amiya_epoque#4.png），而 `#` 在 URL 里是
 * fragment 分隔符——`pet://character/xxx_epoque#4.png` 会被截成 `..._epoque`，
 * 图集直接 404。所以统一改成 URL 安全的 `amiya-*` 前缀。
 *
 * atlas 里第 2 行写着页（png）的文件名，改名之后必须同步改，
 * 否则 Spine 会去找一个不存在的图集页。
 *
 * 用法：node scripts/import-outfits.js
 * 素材默认从 素材/Amiya/<编号>/ 读，编号映射见下面的 SOURCE。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC_ROOT = path.join(ROOT, '素材', 'Amiya');
const DEST = path.join(ROOT, 'assets', 'character');
const LIST = path.join(ROOT, 'src', 'shared', 'outfits.json');

/** 时装 id -> 素材子目录编号 */
const SOURCE = {
  default: '1',
  epoque: '2',
  test: '3',
  winter: '4',
  sale: '5',
  casc: '6',
};

/** atlas 第 2 行是页名；改名前先把所有以 .png 结尾的行找出来 */
function rewriteAtlasPage(atlasText, newPageName) {
  const lines = atlasText.split(/\r?\n/);
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/\.png\s*$/.test(lines[i])) {
      lines[i] = newPageName;
      changed++;
    }
  }
  return { text: lines.join('\n'), changed };
}

function main() {
  if (!fs.existsSync(SRC_ROOT)) {
    console.error('找不到素材目录：' + SRC_ROOT);
    process.exit(1);
  }

  const list = JSON.parse(fs.readFileSync(LIST, 'utf8'));
  fs.mkdirSync(DEST, { recursive: true });

  const report = [];

  for (const outfit of list.outfits) {
    const srcDir = path.join(SRC_ROOT, SOURCE[outfit.id] || '');
    if (!SOURCE[outfit.id] || !fs.existsSync(srcDir)) {
      report.push({ id: outfit.id, ok: false, why: '缺素材目录' });
      continue;
    }

    const files = fs.readdirSync(srcDir);
    const skel = files.find((f) => f.endsWith('.skel'));
    const atlas = files.find((f) => f.endsWith('.atlas'));
    const png = files.find((f) => f.endsWith('.png'));

    if (!skel || !atlas || !png) {
      report.push({ id: outfit.id, ok: false, why: '三件套不全' });
      continue;
    }

    const atlasText = fs.readFileSync(path.join(srcDir, atlas), 'utf8');
    const { text, changed } = rewriteAtlasPage(atlasText, outfit.file + '.png');

    fs.copyFileSync(path.join(srcDir, skel), path.join(DEST, outfit.file + '.skel'));
    fs.copyFileSync(path.join(srcDir, png), path.join(DEST, outfit.file + '.png'));
    fs.writeFileSync(path.join(DEST, outfit.file + '.atlas'), text, 'utf8');

    report.push({
      id: outfit.id,
      ok: true,
      file: outfit.file,
      pageLines: changed,
      size: Math.round(fs.statSync(path.join(DEST, outfit.file + '.png')).size / 1024) + 'KB',
    });
  }

  for (const r of report) {
    if (r.ok) {
      console.log(`  ok   ${r.id.padEnd(8)} -> ${r.file}.{skel,atlas,png}  图集 ${r.size}  页名改写 ${r.pageLines} 处`);
    } else {
      console.log(`  skip ${r.id.padEnd(8)} ${r.why}`);
    }
  }

  const okCount = report.filter((r) => r.ok).length;
  console.log(`\n完成：${okCount}/${list.outfits.length} 套`);
}

main();
