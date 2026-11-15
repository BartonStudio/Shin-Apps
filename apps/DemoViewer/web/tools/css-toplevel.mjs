// CSS 顶层解析器：把一份 CSS 拆成「顶层块」序列，并保留**逐字节还原所需的全部空白信息**。
//
// 为什么要这么细：styles/ 的职责是「按组件可读地组织」，而原始文件的空白（块间换行、
// @media 内部缩进、at-rule 收尾）本身也是内容的一部分。只有把这些空白记录下来，
// 才能既保持可读，又能证明「拼回后与原文逐字节一致」。
//
// 结构：
//   Toplevel  : 普通规则 { kind:'rule', lead, body }
//             | at-rule { kind:'atrule', lead, prelude, tail, inner:[{lead, body}] }
//   lead = 该块之前的空白；tail = 最后一个内层规则与本 at-rule 收尾 `}` 之间的空白
//
// 用法：
//   import { parseCss, rebuildCss } from './css-toplevel.mjs';

// 按花括号配平切出顶层块（返回 [start, endExclusive]）
export function topRanges(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        out.push([start, i + 1]);
        start = i + 1;
      }
    }
  }
  if (start < s.length) out.push([start, s.length]);
  return out;
}

const leadingWs = (s) => /^\s*/.exec(s)[0];

// 去掉 styles/*.css 的文件头注释块（split-css 写入的那段）
export function stripHeader(text) {
  const m = /^\/\*[\s\S]*?\*\/\s*/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

export function parseCss(css) {
  const nodes = [];
  for (const [a, b] of topRanges(css)) {
    const raw = css.slice(a, b);
    const lead = leadingWs(raw);
    const text = raw.slice(lead.length);
    if (!text.trim()) {
      // 纯空白尾巴：作为独立节点保留，保证还原完整
      nodes.push({ kind: 'ws', lead: raw });
      continue;
    }
    const braceAt = text.indexOf('{');
    if (braceAt < 0) {
      nodes.push({ kind: 'ws', lead: raw });
      continue;
    }
    const prelude = text.slice(0, braceAt + 1);
    const head = text.slice(0, braceAt).trim();
    if (/^@(media|supports|container)/.test(head)) {
      const innerRaw = text.slice(braceAt + 1, text.lastIndexOf('}'));
      // 只保留「非纯空白」的内层块；尾随空白单独记为 tail
      const ranges = topRanges(innerRaw).filter(([ia, ib]) => innerRaw.slice(ia, ib).trim());
      const inner = ranges.map(([ia, ib]) => {
        const r = innerRaw.slice(ia, ib);
        const l = leadingWs(r);
        return { lead: l, body: r.slice(l.length).trimEnd() };
      });
      const lastEnd = ranges.length ? ranges[ranges.length - 1][1] : 0;
      const tail = innerRaw.slice(lastEnd);
      nodes.push({ kind: 'atrule', lead, prelude: prelude.trimEnd(), tail, inner });
    } else {
      nodes.push({ kind: 'rule', lead, body: text.trimEnd() });
    }
  }
  return nodes;
}

// 返回最后一个内层规则的结束位置（用于取 at-rule 收尾空白）
function lastInnerEnd(innerRaw) {
  const rs = topRanges(innerRaw);
  if (!rs.length) return 0;
  return rs[rs.length - 1][1];
}

export function rebuildCss(nodes) {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'ws') {
      out += n.lead;
    } else if (n.kind === 'rule') {
      out += n.lead + n.body;
    } else if (n.kind === 'atrule') {
      out += n.lead + n.prelude;
      for (const i of n.inner) out += i.lead + i.body;
      out += n.tail + '}';
    }
  }
  return out;
}

// ── 自测：解析 → 重建 是否逐字节一致 ──
if (process.argv[1] && process.argv[1].endsWith('css-toplevel.mjs')) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const ROOT = path.resolve(import.meta.dirname, '..');
  const src = fs.readFileSync(path.join(ROOT, 'decompiled/index.beautified.css'), 'utf8').replace(/^\uFEFF/, '');
  const nodes = parseCss(src);
  const back = rebuildCss(nodes);
  console.log(`顶层节点 ${nodes.length} 个（rule ${nodes.filter((n) => n.kind === 'rule').length}, atrule ${nodes.filter((n) => n.kind === 'atrule').length}, ws ${nodes.filter((n) => n.kind === 'ws').length}）`);
  console.log(`原文 ${src.length} 字符 / 重建 ${back.length} 字符`);
  console.log(`逐字节一致: ${src === back ? '✅ 是' : '❌ 否'}`);
  if (src !== back) {
    let i = 0;
    while (i < Math.min(src.length, back.length) && src[i] === back[i]) i++;
    console.log(`  首个差异 @${i}`);
    console.log(`    原文: ${JSON.stringify(src.slice(Math.max(0, i - 50), i + 50))}`);
    console.log(`    重建: ${JSON.stringify(back.slice(Math.max(0, i - 50), i + 50))}`);
    process.exitCode = 1;
  }
}
