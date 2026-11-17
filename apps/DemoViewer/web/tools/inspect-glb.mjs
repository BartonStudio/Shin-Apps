// 检查 GLB 文件的 JSON chunk：网格/材质/扩展/自带变换。
// 用法：node tools/inspect-glb.mjs <file.glb>
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw Error('用法: node tools/inspect-glb.mjs <file.glb>');
const buf = readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) throw Error('不是 GLB（magic 不符）');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

console.log('asset:', JSON.stringify(json.asset));
console.log('extensionsUsed:', json.extensionsUsed ?? '(无)');
console.log('场景数:', json.scenes?.length, ' 节点数:', json.nodes?.length, ' 网格数:', json.meshes?.length, ' 材质数:', json.materials?.length);
for (const [i, node] of (json.nodes ?? []).slice(0, 8).entries()) {
  console.log(`node[${i}] name=${node.name ?? '-'} mesh=${node.mesh ?? '-'} children=${node.children?.length ?? 0} t=${JSON.stringify(node.translation ?? null)} r=${JSON.stringify(node.rotation ?? null)} s=${JSON.stringify(node.scale ?? null)} extras=${JSON.stringify(node.extras ?? null)}`);
}
for (const [i, mesh] of (json.meshes ?? []).slice(0, 6).entries()) {
  const prims = mesh.primitives.map((p) => ({
    mode: p.mode ?? 4,
    attrs: Object.keys(p.attributes),
    indices: p.indices,
    material: p.material,
    extras: p.extras ? Object.keys(p.extras) : null,
  }));
  console.log(`mesh[${i}] name=${mesh.name ?? '-'} prims=${JSON.stringify(prims).slice(0, 300)}`);
}
const accs = (json.accessors ?? []).slice(0, 6).map((a) => ({ type: a.type, count: a.count, comp: a.componentType, min: a.min, max: a.max }));
console.log('accessors 前 6 个:', JSON.stringify(accs));
