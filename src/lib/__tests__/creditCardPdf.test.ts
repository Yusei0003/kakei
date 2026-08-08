import { describe, expect, it } from "vitest";
import { parseCreditCardText } from "@/lib/creditCardPdf";

// 楽天カード明細のテキスト抽出が正常に行えた場合を想定したサンプル行
// (実際の請求書PDFはフォントの都合で標準ライブラリでは抽出できないケースがあるため、
//  抽出さえできれば正しく行を読めることをこのテストで担保する)
const SAMPLE_TEXT = `
2026/07/07 ０５月度再振替手数料 本人* 1回払い 220 0 220 220 220 0
2026/06/20 カメイ燃料代 本人* 1回払い 7,722 0 7,722 7,722 7,722 0
2026/06/07 ＥＴＣカード売上 ETC* 1回払い 970 0 970 970 970 0
2026/06/04 AMAZON.CO.JP利用国LUX 本人* 1回払い 660 0 660 660 660 0
これは取引行ではない説明文です
`;

describe("parseCreditCardText", () => {
  it("日付・店名・利用金額を行から抽出する", () => {
    const result = parseCreditCardText(SAMPLE_TEXT);
    expect(result).toHaveLength(4);
  });

  it("カンマ区切りの金額を正しく数値化する", () => {
    const result = parseCreditCardText(SAMPLE_TEXT);
    const fuel = result.find((t) => t.storeName === "カメイ燃料代");
    expect(fuel?.amount).toBe(7722);
  });

  it("ETCカード利用分も抽出できる", () => {
    const result = parseCreditCardText(SAMPLE_TEXT);
    const etc = result.find((t) => t.storeName === "ＥＴＣカード売上");
    expect(etc?.amount).toBe(970);
  });

  it("取引行以外の説明文は無視する", () => {
    const result = parseCreditCardText(SAMPLE_TEXT);
    expect(result.some((t) => t.storeName.includes("説明文"))).toBe(false);
  });
});
