// ============================================================================
// 反混淆版本：CS:GO/CS2 准星分享码（share code）解码器
// 原文范围：decompiled/index.beautified.js L28269–28348（切片 00b-share-code）
// 压缩名：ug = SHARE_CODE_ALPHABET，dg = BASE(57n)，fg = SHARE_CODE_PATTERN，
//         pg = DEFAULT_CROSSHAIR，mg = LEGACY_COLOR_NAMES，hg = crosshairColor,
//         gg = toInt8，_g = decodeShareCodeBytes，vg = parseCrosshairCode
// 依赖：无
//
// 用途：玩家面板/名牌上的准星预览。CS:GO 分享码形如 CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx，
// 是「26 个字母 + 10 个数字去掉易混字符(IO l 0 1)」组成的 57 进制大整数，
// 再转成 18 字节的定长结构，逐字节按位取出准星的各个参数。
// ============================================================================

// 57 字符表：A-Z 去掉 I、O；a-z 去掉 l；2-9
var SHARE_CODE_ALPHABET = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
var BASE = BigInt(57);
var SHARE_CODE_PATTERN = /^CSGO(-?[\w]{5}){5}$/; // CSGO- + 5 组×5 字符

// 默认准星参数（用于缺失字段的兜底）
var DEFAULT_CROSSHAIR = {
  length: 2,
  thickness: 0.5,
  gap: -1,
  color: 1,
  red: 0,
  green: 255,
  blue: 0,
  alpha: 255,
  alphaEnabled: true,
  outlineEnabled: false,
  outline: 0,
  centerDotEnabled: false,
  tStyleEnabled: false,
  style: 4,
  splitDistance: 0,
  followRecoil: false,
  fixedCrosshairGap: 0,
  innerSplitAlpha: 0,
  outerSplitAlpha: 1,
  splitSizeRatio: 1,
  deployedWeaponGapEnabled: false,
};

// 旧式「预设色号」→ RGB。color 字段是 0..4 的枚举，超出时回落到 red/green/blue 自定义值。
var LEGACY_COLOR_NAMES = {
  0: [255, 0, 0],
  1: [0, 255, 0],
  2: [255, 255, 0],
  3: [0, 0, 255],
  4: [0, 255, 255],
};

function crosshairColor(c) {
  return LEGACY_COLOR_NAMES[c.color] ?? [c.red, c.green, c.blue];
}

// 取有符号 8 位（分享码里的 gap/thickness 可能是负数）
function toInt8(byte) {
  return (byte << 24) >> 24;
}

// 分享码 → 18 字节数组（长度 36 个十六进制字符 ÷ 2）
function decodeShareCodeBytes(code) {
  if (!SHARE_CODE_PATTERN.test(code)) throw Error('invalid share code');
  // 去掉前缀与连字符，然后**倒序**——分享码是小端 57 进制
  const chars = Array.from(code.replace(/CSGO|-/g, '')).reverse();
  let acc = 0n;
  for (let i = 0; i < chars.length; i++) {
    const digit = SHARE_CODE_ALPHABET.indexOf(chars[i]);
    if (digit < 0) throw Error('invalid character');
    acc = acc * BASE + BigInt(digit);
  }
  const hex = acc.toString(16).padStart(36, '0');
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes;
}

// 分享码 → 准星参数对象。
// 校验：第 0 字节 = 其后所有字节之和 mod 256（分享码自带的防误篡改校验）。
// 失败（格式错 / 校验错）一律返回 null，调用方据此跳过准星绘制。
function parseCrosshairCode(code) {
  try {
    const bytes = decodeShareCodeBytes(code);
    const checksum = bytes.slice(1).reduce((sum, b) => sum + b, 0) % 256;
    if (bytes[0] !== checksum) return null;

    return {
      // 第 1 字节未使用（分享码版本位，本实现忽略）
      gap: toInt8(bytes[2]) / 10,
      outline: bytes[3] / 2,
      red: bytes[4],
      green: bytes[5],
      blue: bytes[6],
      alpha: bytes[7],
      // 第 8 字节：低 3 位 = splitDistance；位 4 = followRecoil
      splitDistance: bytes[8] & 7,
      followRecoil: ((bytes[8] >> 4) & 8) == 8,
      fixedCrosshairGap: toInt8(bytes[9]) / 10,
      // 第 10 字节：低 3 位 = 预设色号；位 3 = 描边开关；高 4 位 = 内分割透明度×10
      color: bytes[10] & 7,
      outlineEnabled: (bytes[10] & 8) == 8,
      innerSplitAlpha: (bytes[10] >> 4) / 10,
      // 第 11 字节：低 4 位 = 外分割透明度×10；高 4 位 = 分割尺寸比×10
      outerSplitAlpha: (bytes[11] & 15) / 10,
      splitSizeRatio: (bytes[11] >> 4) / 10,
      thickness: bytes[12] / 10,
      // 第 13 字节：位 4/5/6/7 = 中心点 / 部署武器间距 / 透明度开关 / T 形；低 4 位>>1 = style
      centerDotEnabled: ((bytes[13] >> 4) & 1) == 1,
      deployedWeaponGapEnabled: ((bytes[13] >> 4) & 2) == 2,
      alphaEnabled: ((bytes[13] >> 4) & 4) == 4,
      tStyleEnabled: ((bytes[13] >> 4) & 8) == 8,
      style: (bytes[13] & 15) >> 1,
      length: bytes[14] / 10,
    };
  } catch {
    return null;
  }
}
