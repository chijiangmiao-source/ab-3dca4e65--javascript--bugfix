/**
 * 页面与自动核对共用的 /api/solve 请求构造与结果处理。
 *
 * 代价在解析阶段即为 BigInt，这里负责把它逐位写入请求 JSON、并把响应中的
 * 任意大小整数还原为 BigInt，保证从文本录入到结果展示全程不经过丢精度的 Number。
 */

import { parseJsonBigInts, stringifyJson } from "./bigint.js";

/** 由已解析的采样点 / 根 / 通道构造请求体 JSON 文本（代价以裸整数逐位输出）。 */
export function buildSolveRequestBody({ points, root, channels }) {
  return stringifyJson({
    points,
    root,
    channels: channels.map((c) => ({ id: c.id, from: c.from, to: c.to, cost: c.cost })),
  });
}

/** 解析 /api/solve 响应文本：整数字面量（含超过 2^53-1 者）保留为 BigInt。 */
export function parseSolveResponse(text) {
  return parseJsonBigInts(text);
}

/** 按树表面板的口径精确合计逐边代价，返回完整十进制字符串。 */
export function treeTotalCost(tree) {
  return tree
    .reduce((acc, e) => acc + (typeof e.cost === "bigint" ? e.cost : BigInt(e.cost)), 0n)
    .toString();
}
