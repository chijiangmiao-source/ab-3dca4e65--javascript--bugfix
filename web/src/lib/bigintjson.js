/**
 * 大整数安全的 JSON 处理。
 *
 * 通道代价允许任意合法的非负整数，可能超过 JavaScript 的安全整数范围
 * Number.MAX_SAFE_INTEGER（2^53−1）。本模块保证：
 *   - 解析响应文本时，所有整数字面量转为 BigInt，不经过 Number；
 *   - 序列化请求时，BigInt 输出为裸的 JSON 整数字面量（不带引号）；
 *   - 比较与展示一律基于完整十进制值，不丢精度。
 */

/** 匹配 JSON 字符串（整体吃掉，避免把字符串里的数字误判）或数字字面量。 */
const TOKEN_RE = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/**
 * 以 BigInt 保留全部整数精度的 JSON.parse。
 * 整数字面量（含超过 2^53−1 的）解析为 bigint；浮点 / 指数字面量仍为 number。
 */
export function parseJsonBigInts(text) {
  const marked = String(text).replace(TOKEN_RE, (tok) => {
    if (tok.startsWith('"')) return tok;
    if (/^-?\d+$/.test(tok)) return JSON.stringify({ __bigint__: tok });
    return JSON.stringify({ __float__: tok });
  });
  return JSON.parse(marked, (_key, value) => {
    if (value && typeof value === "object" && "__bigint__" in value) {
      return BigInt(value.__bigint__);
    }
    if (value && typeof value === "object" && "__float__" in value) {
      return Number(value.__float__);
    }
    return value;
  });
}

const BIGINT_SENTINEL = "BIGINT";

/**
 * 以裸整数字面量序列化含 bigint 的对象（发送给只接受 JSON 数字的 API）。
 * 普通字符串不会与私有区哨兵冲突。
 */
export function stringifyJsonBigInts(value) {
  return JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? `${BIGINT_SENTINEL}${v.toString()}${BIGINT_SENTINEL}` : v
  ).replace(new RegExp(`"${BIGINT_SENTINEL}(-?\\d+)${BIGINT_SENTINEL}"`, "g"), "$1");
}

/** 任意可表示为非负整数的输入（bigint / 十进制字符串 / 安全 number）转 bigint。 */
export function toBigInt(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`不安全的整数，无法精确转换: ${value}`);
    }
    return BigInt(value);
  }
  return BigInt(String(value).trim());
}

/** 完整十进制展示：避免 String(number) 在 1e21 后输出指数记数法。 */
export function formatBigInt(value) {
  return toBigInt(value).toString();
}

/** 对两个可整数比较的值返回 -1 / 0 / 1（全程 bigint，不丢精度）。 */
export function compareBigInt(a, b) {
  const x = toBigInt(a);
  const y = toBigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
