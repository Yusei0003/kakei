import { describe, expect, it } from "vitest";
import { parsePaypayCsv } from "@/lib/paypayCsv";

// 実際のPayPayエクスポートCSVの抜粋（支払い/チャージ/送金/ポイント獲得を一通り含む）
const SAMPLE_CSV = `取引日,出金金額（円）,入金金額（円）,海外出金金額,通貨,変換レート（円）,利用国,取引内容,取引先,取引方法,支払い区分,利用者,取引番号
2026/07/31 09:10:28,375,-,-,-,-,-,支払い,セブン-イレブン - 陸前高田竹駒町,"PayPayポイント (5円), PayPay残高 (370円)",-,-,05036373381446131712
2026/07/30 19:13:20,-,"1,000",-,-,-,-,チャージ,PayPay,ゆうちょ銀行 *****91,-,-,02324793638253649938
2026/07/24 14:57:04,950,-,-,-,-,-,送った金額,klay11,PayPay残高,-,-,02320208545916534784
2026/07/05 07:44:49,-,4,-,-,-,-,ポイント、残高の獲得,ローソン,PayPayポイント,-,-,05017032808700837888
2026/07/05 07:44:49,928,-,-,-,-,-,支払い,ローソン - 陸前高田大隅,"PayPayポイント (9円), PayPay残高 (919円)",-,-,05017032808700837888`;

describe("parsePaypayCsv", () => {
  it("支払いと送金のみを支出として抽出する", () => {
    const result = parsePaypayCsv(SAMPLE_CSV);
    expect(result.transactions).toHaveLength(3);
    expect(result.skippedCount).toBe(2); // チャージ1件 + ポイント獲得1件
    expect(result.unparsedLines).toHaveLength(0);
  });

  it("支払い行を正しくパースする（金額・店名・取引番号・送金フラグ）", () => {
    const result = parsePaypayCsv(SAMPLE_CSV);
    const conbini = result.transactions[0];
    expect(conbini.amount).toBe(375);
    expect(conbini.storeName).toBe("セブン-イレブン - 陸前高田竹駒町");
    expect(conbini.sourceRef).toBe("05036373381446131712");
    expect(conbini.isTransfer).toBe(false);
  });

  it("送った金額（個人間送金）をisTransfer=trueとしてパースする", () => {
    const result = parsePaypayCsv(SAMPLE_CSV);
    const transfer = result.transactions.find((t) => t.storeName === "klay11");
    expect(transfer).toBeDefined();
    expect(transfer?.amount).toBe(950);
    expect(transfer?.isTransfer).toBe(true);
  });

  it("日付をJST基準で正しく解釈する", () => {
    const result = parsePaypayCsv(SAMPLE_CSV);
    const conbini = result.transactions[0];
    // 2026/07/31 09:10:28 JST === 2026/07/31 00:10:28 UTC
    expect(conbini.occurredAt.toISOString()).toBe("2026-07-31T00:10:28.000Z");
  });

  it("引用符内にカンマを含むフィールドを正しく扱う", () => {
    const result = parsePaypayCsv(SAMPLE_CSV);
    const lawson = result.transactions.find((t) =>
      t.storeName.startsWith("ローソン")
    );
    expect(lawson?.amount).toBe(928);
  });
});
