import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TreePanel from "./TreePanel.jsx";

const BIG = "9007199254740992";
const BIG_PLUS_ONE = "9007199254740993";

describe("<TreePanel /> 大整数呈现", () => {
  it("总代价与逐边代价在 BigInt 数据处理后仍显示完整十进制", () => {
    const tree = [
      { id: "e2", from: "r", to: "a", cost: BigInt(BIG) },
    ];
    const html = renderToString(
      <TreePanel tree={tree} totalCost={BigInt(BIG)} evidence={new Map()} onSelect={() => {}} />
    );
    expect(html).toContain(BIG);
    expect(html).not.toContain(BIG_PLUS_ONE);
    // 合计行（tree.reduce 的 BigInt 求和结果）同样完整
    expect(html).toContain(`<td class="num strong">${BIG}</td>`);
    // 不得以 double 指数 / 丢精度形式呈现
    expect(html).not.toContain("9.007199254740992e");
  });
});
