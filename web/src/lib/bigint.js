/**
 * 任意精度非负整数支持。
 *
 * 通道代价在接口规范中是「任意合法非负整数」，可能超过 JavaScript 的安全整数
 * 范围（Number.MAX_SAFE_INTEGER = 2^53-1）。本模块提供：
 *   - 文本 / BigInt / 数字之间的安全转换与十进制展示；
 *   - 十进制字符串的精确加减（用于总代价汇总与记录中的代价修正展示）；
 *   - 保留大整数精度的 JSON 解析与序列化（响应解析、请求提交）。
 *
 * 内部一律以 BigInt 承载代价；只在界面展示时转为十进制字符串。
 */

/** 安全整数上界（2^53-1），超过它的 Number 已不能逐整数表示。 */
export const MAX_SAFE_COST = Number.MAX_SAFE_INTEGER;

const INT_TEXT_RE = /^-?\d+$/;
const NON_NEG_INT_TEXT_RE = /^\d+$/;

/** 把十进制字符串 / BigInt / 安全 Number 统一转为 BigInt；不安全的 Number 直接拒绝。 */
export function toBigInt(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "string") {
    if (!INT_TEXT_RE.test(value)) {
      throw new TypeError(`不是合法的十进制整数文本: ${JSON.stringify(value)}`);
    }
    return BigInt(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`拒绝精度已丢失的 Number: ${value}`);
    }
    return BigInt(value);
  }
  throw new TypeError(`无法转换为 BigInt: ${String(value)}`);
}

/** 是否为可解析的非负整数十进制文本（不丢精度）。 */
export function isNonNegativeIntText(value) {
  return typeof value === "string" && NON_NEG_INT_TEXT_RE.test(value);
}

/** 格式化为完整十进制字符串（界面展示的唯一出口）。 */
export function formatDecimal(value) {
  return toBigInt(value).toString();
}

/** 精确加法：返回十进制字符串。 */
export function addDecimal(a, b) {
  return (toBigInt(a) + toBigInt(b)).toString();
}

/** 精确减法：要求 a >= b，返回十进制字符串。 */
export function subtractDecimal(a, b) {
  const x = toBigInt(a);
  const y = toBigInt(b);
  if (x < y) throw new RangeError(`减法要求被减数 >= 减数：${x} < ${y}`);
  return (x - y).toString();
}

// ---------------------------------------------------------------------------
// 保留大整数的 JSON 序列化 / 解析
// ---------------------------------------------------------------------------

/**
 * JSON 序列化：BigInt 以裸 JSON 整数输出（而非加引号的字符串）。
 * 仅处理本接口用到的类型：对象、数组、字符串、布尔、null、数字与 BigInt。
 */
export function stringifyJson(value) {
  if (typeof value === "bigint") return value.toString();
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON 不支持 NaN / Infinity");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stringifyJson(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const parts = Object.entries(value).map(
      ([k, v]) => `${JSON.stringify(k)}:${stringifyJson(v)}`
    );
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`无法 JSON 序列化的值: ${String(value)}`);
}

/**
 * 解析 JSON 文本：所有整数字面量（无论是否超出 2^53-1）都解析为 BigInt，
 * 小数 / 指数记法仍解析为 Number。代价相关字段全部为非负整数，故精度完整。
 * 手写递归下降，避免原生 JSON.parse 先把整数舍入成 Number。
 */
export function parseJsonBigInts(text) {
  const src = String(text);
  const len = src.length;
  let i = 0;

  function skipWhitespace() {
    while (i < len) {
      const ch = src[i];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") i += 1;
      else break;
    }
  }

  function parseString() {
    i += 1; // 开引号
    let out = "";
    while (i < len) {
      const ch = src[i++];
      if (ch === '"') return out;
      if (ch === "\\") {
        const esc = src[i++];
        if (esc === "u") {
          const hex = src.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new SyntaxError(`非法的 Unicode 转义，位置 ${i - 2}`);
          }
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (!(esc in simple)) throw new SyntaxError(`非法的转义字符 \\${esc}`);
          out += simple[esc];
        }
      } else {
        out += ch;
      }
    }
    throw new SyntaxError("未终止的 JSON 字符串");
  }

  function parseNumber() {
    const start = i;
    if (src[i] === "-") i += 1;
    while (i < len && src[i] >= "0" && src[i] <= "9") i += 1;
    let isFloat = false;
    if (src[i] === ".") {
      isFloat = true;
      i += 1;
      while (i < len && src[i] >= "0" && src[i] <= "9") i += 1;
    }
    if (src[i] === "e" || src[i] === "E") {
      isFloat = true;
      i += 1;
      if (src[i] === "+" || src[i] === "-") i += 1;
      while (i < len && src[i] >= "0" && src[i] <= "9") i += 1;
    }
    const raw = src.slice(start, i);
    if (raw === "" || raw === "-") throw new SyntaxError(`非法数字，位置 ${start}`);
    return isFloat ? Number(raw) : BigInt(raw);
  }

  function parseValue() {
    skipWhitespace();
    const ch = src[i];
    if (ch === "{") {
      i += 1;
      const obj = {};
      skipWhitespace();
      if (src[i] === "}") {
        i += 1;
        return obj;
      }
      while (true) {
        skipWhitespace();
        if (src[i] !== '"') throw new SyntaxError(`对象键须为字符串，位置 ${i}`);
        const key = parseString();
        skipWhitespace();
        if (src[i] !== ":") throw new SyntaxError(`对象中缺少冒号，位置 ${i}`);
        i += 1;
        obj[key] = parseValue();
        skipWhitespace();
        if (src[i] === ",") {
          i += 1;
          continue;
        }
        if (src[i] === "}") {
          i += 1;
          return obj;
        }
        throw new SyntaxError(`对象中缺少逗号或右括号，位置 ${i}`);
      }
    }
    if (ch === "[") {
      i += 1;
      const arr = [];
      skipWhitespace();
      if (src[i] === "]") {
        i += 1;
        return arr;
      }
      while (true) {
        arr.push(parseValue());
        skipWhitespace();
        if (src[i] === ",") {
          i += 1;
          continue;
        }
        if (src[i] === "]") {
          i += 1;
          return arr;
        }
        throw new SyntaxError(`数组中缺少逗号或右括号，位置 ${i}`);
      }
    }
    if (ch === '"') return parseString();
    if (src.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (src.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (src.startsWith("null", i)) {
      i += 4;
      return null;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) return parseNumber();
    throw new SyntaxError(`无法识别的 JSON 值，位置 ${i}`);
  }

  const value = parseValue();
  skipWhitespace();
  if (i !== len) throw new SyntaxError(`JSON 尾部存在多余字符，位置 ${i}`);
  return value;
}
