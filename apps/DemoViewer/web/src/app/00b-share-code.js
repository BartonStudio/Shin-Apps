// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 28269–28348 行（切片 3/40）
// 角色：CS:GO 匹配分享码编解码：57 字符字母表 ug（ABCDEFGHJKLMNOPQRSTUVWXYZ…）+ hg/gg/_g/vg
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var ug = `ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789`,
  dg = BigInt(57),
  fg = /^CSGO(-?[\w]{5}){5}$/,
  pg = {
    length: 2,
    thickness: 0.5,
    gap: -1,
    color: 1,
    red: 0,
    green: 255,
    blue: 0,
    alpha: 255,
    alphaEnabled: !0,
    outlineEnabled: !1,
    outline: 0,
    centerDotEnabled: !1,
    tStyleEnabled: !1,
    style: 4,
    splitDistance: 0,
    followRecoil: !1,
    fixedCrosshairGap: 0,
    innerSplitAlpha: 0,
    outerSplitAlpha: 1,
    splitSizeRatio: 1,
    deployedWeaponGapEnabled: !1,
  },
  mg = { 0: [255, 0, 0], 1: [0, 255, 0], 2: [255, 255, 0], 3: [0, 0, 255], 4: [0, 255, 255] }
function hg(e) {
  return mg[e.color] ?? [e.red, e.green, e.blue]
}
function gg(e) {
  return (e << 24) >> 24
}
function _g(e) {
  if (!fg.test(e)) throw Error(`invalid share code`)
  let t = Array.from(e.replace(/CSGO|-/g, ``)).reverse(),
    n = 0n
  for (let e = 0; e < t.length; e++) {
    let r = ug.indexOf(t[e])
    if (r < 0) throw Error(`invalid character`)
    n = n * dg + BigInt(r)
  }
  let r = n.toString(16).padStart(36, `0`),
    i = []
  for (let e = 0; e < r.length; e += 2) i.push(parseInt(r.slice(e, e + 2), 16))
  return i
}
function vg(e) {
  try {
    let t = _g(e),
      n = t.slice(1).reduce((e, t) => e + t, 0) % 256
    return t[0] === n
      ? {
          gap: gg(t[2]) / 10,
          outline: t[3] / 2,
          red: t[4],
          green: t[5],
          blue: t[6],
          alpha: t[7],
          splitDistance: t[8] & 7,
          followRecoil: ((t[8] >> 4) & 8) == 8,
          fixedCrosshairGap: gg(t[9]) / 10,
          color: t[10] & 7,
          outlineEnabled: (t[10] & 8) == 8,
          innerSplitAlpha: (t[10] >> 4) / 10,
          outerSplitAlpha: (t[11] & 15) / 10,
          splitSizeRatio: (t[11] >> 4) / 10,
          thickness: t[12] / 10,
          centerDotEnabled: ((t[13] >> 4) & 1) == 1,
          deployedWeaponGapEnabled: ((t[13] >> 4) & 2) == 2,
          alphaEnabled: ((t[13] >> 4) & 4) == 4,
          tStyleEnabled: ((t[13] >> 4) & 8) == 8,
          style: (t[13] & 15) >> 1,
          length: t[14] / 10,
        }
      : null
  } catch {
    return null
  }
}
