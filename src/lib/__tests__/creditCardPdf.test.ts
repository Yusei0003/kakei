import { describe, expect, it } from "vitest";
import { parseCreditCardLines } from "@/lib/creditCardPdf";

// 楽天カード明細PDFをmupdfでテキスト抽出すると実際にこの形（1項目1行）になる。
// (2026/07分の実データで確認済み)
const SAMPLE_LINES = `
2026/07/07
０５月度再振替手数料
本人*
1回払い
        220
        0
        220
        220
          0
        220

2026/06/20
カメイ燃料代
本人*
1回払い
      7,722
        0
      7,722
      7,722
          0
      7,722

2026/06/07
ＥＴＣカード売上
ETC*
1回払い
        970
        0
        970
        970
          0
        970

ﾓﾘｵｶ       ﾊﾅﾏｷｸｳｺｳﾎ


2026/06/04
AMAZON.CO.JP利用国LUX
本人*
1回払い
        660
        0
        660
        660
          0
        660
`.split("\n");

describe("parseCreditCardLines", () => {
  it("1取引=複数行のブロックから店名・日付・利用金額を抽出する", () => {
    const result = parseCreditCardLines(SAMPLE_LINES);
    expect(result).toHaveLength(4);
  });

  it("カンマ区切りの利用金額を正しく数値化する", () => {
    const result = parseCreditCardLines(SAMPLE_LINES);
    const fuel = result.find((t) => t.storeName === "カメイ燃料代");
    expect(fuel?.amount).toBe(7722);
  });

  it("ETCカード利用分（支払者マーカーがETC*）も抽出できる", () => {
    const result = parseCreditCardLines(SAMPLE_LINES);
    const etc = result.find((t) => t.storeName === "ＥＴＣカード売上");
    expect(etc?.amount).toBe(970);
  });

  it("取引ブロックの後に続く住所の継続行（本人*/払いを含まない）は取引として拾わない", () => {
    const result = parseCreditCardLines(SAMPLE_LINES);
    expect(result.some((t) => t.storeName.includes("ﾓﾘｵｶ"))).toBe(false);
  });

  it("日付を正しく解釈する", () => {
    const result = parseCreditCardLines(SAMPLE_LINES);
    const fee = result.find((t) => t.storeName === "０５月度再振替手数料");
    // 2026/07/07 00:00 JST === 2026/07/06 15:00 UTC
    expect(fee?.occurredAt.toISOString()).toBe("2026-07-06T15:00:00.000Z");
  });
});
