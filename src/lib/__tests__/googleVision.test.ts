import { describe, expect, it } from "vitest";
import { extractTotalAmount } from "@/lib/googleVision";

describe("extractTotalAmount", () => {
  it("「合計」行の金額を優先して取り出す", () => {
    const text = "セブンイレブン\nおにぎり 150\nお茶 120\n合計 270円\n";
    expect(extractTotalAmount(text)).toBe(270);
  });

  it("キーワードの次の行に金額がある場合も拾う", () => {
    const text = "レシート\n小計\n1,200円\nありがとうございました";
    expect(extractTotalAmount(text)).toBe(1200);
  });

  it("キーワードが見つからない場合は最大金額を採用する", () => {
    const text = "商品A 100\n商品B 500\n商品C 300";
    expect(extractTotalAmount(text)).toBe(500);
  });

  it("金額が見つからない場合はnullを返す", () => {
    expect(extractTotalAmount("特にありません")).toBeNull();
  });
});
