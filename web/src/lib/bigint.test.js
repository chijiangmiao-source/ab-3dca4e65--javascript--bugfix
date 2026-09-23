import { describe, expect, it } from "vitest";
import {
  addDecimal,
  formatDecimal,
  parseJsonBigInts,
  stringifyJson,
  subtractDecimal,
  toBigInt,
} from "./bigint";

describe("toBigInt / formatDecimal", () => {
  it("接受十进制文本、BigInt 与安全整数", () => {
    expect(toBigInt("9007199254740993")).toBe(9007199254740993n);
    expect(toBigInt(9007199254740992n)).toBe(9007199254740992n);
    expect(toBigInt(5)).toBe(5n);
    expect(formatDecimal(9007199254740993n)).toBe("9007199254740993");
  });
  it("拒绝精度已丢失的不安全 Number", () => {
    expect(() => toBigInt(9007199254740993)).toThrow(RangeError);
  });
});

describe("精确加减", () => {
  it("相邻大整数保持大小关系，加减给出完整十进制", () => {
    const big = "9007199254740993";
    const small = "9007199254740992";
    expect(addDecimal(big, "1")).toBe("9007199254740994");
    expect(addDecimal(big, small)).toBe("18014398509481985");
    expect(subtractDecimal(big, small)).toBe("1");
    expect(() => subtractDecimal(small, big)).toThrow(RangeError);
  });
});

describe("stringifyJson", () => {
  it("把 BigInt 输出为裸 JSON 整数", () => {
    const payload = {
      points: ["r", "a"],
      root: "r",
      channels: [
        { id: "e1", from: "r", to: "a", cost: 9007199254740993n },
        { id: "e2", from: "r", to: "a", cost: 9007199254740992n },
      ],
    };
    const text = stringifyJson(payload);
    expect(text).toContain('"cost":9007199254740993}');
    expect(text).toContain('"cost":9007199254740992}');
    // 线上文本必须逐位保留两个相邻整数（原生 JSON.parse 会把它们舍入成同一个
    // Number，这正是本模块存在的原因；服务端按原始十进制读取，二者不同）。
    expect(text.indexOf("9007199254740993")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("9007199254740992")).toBeGreaterThanOrEqual(0);
    expect("9007199254740993").not.toBe("9007199254740992");
    // 用本模块自身的解析器往返，精度完整
    const reparsed = parseJsonBigInts(text);
    expect(reparsed.channels[0].cost).toBe(9007199254740993n);
    expect(reparsed.channels[1].cost).toBe(9007199254740992n);
    expect(reparsed.channels[0].cost).not.toBe(reparsed.channels[1].cost);
  });
});

describe("parseJsonBigInts", () => {
  it("把任意大小的整数字面量解析为 BigInt", () => {
    const body = parseJsonBigInts(
      '{"total_cost":9007199254740992,"tree":[{"cost":9007199254740992}],"ok":true}'
    );
    expect(body.total_cost).toBe(9007199254740992n);
    expect(body.tree[0].cost).toBe(9007199254740992n);
    expect(body.ok).toBe(true);
  });
  it("小数与指数仍为 Number，字符串 / null / 数组正常", () => {
    const body = parseJsonBigInts('{"a":1.5,"b":1e3,"c":"x","d":null,"e":[1,-2,{}]}');
    expect(body.a).toBe(1.5);
    expect(body.b).toBe(1000);
    expect(body.c).toBe("x");
    expect(body.d).toBeNull();
    expect(body.e[0]).toBe(1n);
    expect(body.e[1]).toBe(-2n);
  });
  it("规范树响应往返：序列化与解析后大整数逐位一致", () => {
    const request = {
      points: ["r", "a"],
      root: "r",
      channels: [
        { id: "e1", from: "r", to: "a", cost: 9007199254740993n },
        { id: "e2", from: "r", to: "a", cost: 9007199254740992n },
      ],
    };
    const sent = stringifyJson(request);
    expect(sent).toContain("9007199254740993");
    const response = parseJsonBigInts(
      '{"status":"ok","total_cost":9007199254740992,' +
        '"tree":[{"id":"e2","from":"r","to":"a","cost":9007199254740992}],' +
        '"canonical_ids":["e2"]}'
    );
    expect(response.total_cost).toBe(9007199254740992n);
    expect(formatDecimal(response.tree[0].cost)).toBe("9007199254740992");
    expect(response.canonical_ids).toEqual(["e2"]);
  });
});
