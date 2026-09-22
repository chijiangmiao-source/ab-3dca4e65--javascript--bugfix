import { describe, expect, it } from "vitest";
import {
  compareBigInt,
  formatBigInt,
  parseJsonBigInts,
  stringifyJsonBigInts,
  toBigInt,
} from "./bigintjson";

describe("parseJsonBigInts", () => {
  it("安全范围内的整数解析为 bigint", () => {
    const body = parseJsonBigInts('{"total_cost": 8, "ok": true, "name": "r"}');
    expect(body.total_cost).toBe(8n);
    expect(body.ok).toBe(true);
    expect(body.name).toBe("r");
  });

  it("超过 2^53−1 的相邻整数保持可区分", () => {
    const body = parseJsonBigInts(
      '{"a": 9007199254740993, "b": 9007199254740992}'
    );
    expect(body.a).toBe(9007199254740993n);
    expect(body.b).toBe(9007199254740992n);
    expect(body.a).not.toBe(body.b);
    expect(body.a > body.b).toBe(true);
  });

  it("嵌套数组中的逐边代价、零值与负调整代价均精确保留", () => {
    const body = parseJsonBigInts(
      '{"tree": [{"id": "e2", "cost": 9007199254740992}, {"id": "e3", "cost": 0}],' +
        '"adjusted_cost": -42}'
    );
    expect(body.tree[0].cost).toBe(9007199254740992n);
    expect(body.tree[1].cost).toBe(0n);
    expect(body.adjusted_cost).toBe(-42n);
  });

  it("字符串内容中的数字不会被误转为 bigint", () => {
    const body = parseJsonBigInts('{"reason": "cost 9007199254740993 is fine", "cost": 1}');
    expect(body.reason).toBe("cost 9007199254740993 is fine");
    expect(body.cost).toBe(1n);
  });

  it("指数 / 小数字面量仍按 number 解析", () => {
    const body = parseJsonBigInts('{"x": 1.5, "y": 1e3}');
    expect(body.x).toBe(1.5);
    expect(body.y).toBe(1000);
  });
});

describe("stringifyJsonBigInts", () => {
  it("bigint 输出为裸整数字面量而非带引号字符串", () => {
    const text = stringifyJsonBigInts({
      points: ["r", "a"],
      channels: [{ id: "e1", from: "r", to: "a", cost: 9007199254740993n }],
    });
    expect(text).toContain('"cost":9007199254740993');
    expect(text).not.toContain('"9007199254740993"');
    expect(parseJsonBigInts(text).channels[0].cost).toBe(9007199254740993n);
  });

  it("与普通 JSON.stringify 对非 bigint 数据等价（键序一致）", () => {
    const data = { root: "r", n: 0, flags: [true, null] };
    expect(stringifyJsonBigInts(data)).toBe(JSON.stringify(data));
  });
});

describe("toBigInt / formatBigInt / compareBigInt", () => {
  it("十进制字符串、bigint、安全 number 均可精确转换", () => {
    expect(toBigInt("9007199254740993")).toBe(9007199254740993n);
    expect(toBigInt(9007199254740993n)).toBe(9007199254740993n);
    expect(toBigInt(5)).toBe(5n);
  });

  it("formatBigInt 对大整数输出完整十进制", () => {
    expect(formatBigInt(10n ** 30n)).toBe("1" + "0".repeat(30));
    expect(formatBigInt("9007199254740992")).toBe("9007199254740992");
  });

  it("compareBigInt 保持相邻大整数的大小关系（93 < 92 不成立）", () => {
    expect(compareBigInt("9007199254740993", "9007199254740992")).toBe(1);
    expect(compareBigInt(9007199254740992n, 9007199254740993n)).toBe(-1);
    expect(compareBigInt("7", 7n)).toBe(0);
  });

  it("BigInt 求和与格式化对平行大通道场景精确", () => {
    const costs = ["9007199254740992", "0"];
    const total = costs.reduce((s, c) => s + toBigInt(c), 0n);
    expect(formatBigInt(total)).toBe("9007199254740992");
  });
});
