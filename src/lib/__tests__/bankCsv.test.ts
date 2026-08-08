import { describe, expect, it } from "vitest";
import { parseBankCsv } from "@/lib/bankCsv";

// ゆうちょ銀行「入出金明細」の抜粋(実データをiconvでデコードしたもの)。
// ヘッダーの前に口座情報の説明行が数行入るのも実際の形式どおり。
const YUCHO_SAMPLE = `お客さま口座情報
現在高：,"2,689",円,
出力日時：令和 08 年 08 月 08 日 23 時 26 分
お客さま口座番号：18370-00014091
照会対象：全期間
明細件数：20
取引日,入出金明細ＩＤ,受入金額（円）,払出金額（円）,詳細１,詳細２,現在（貸付）高,
20260707,202607070000001,,10000,カード,,17975,
20260719,202607190000001,,1000,ＲＴ,(PAYPAY),16975,
20260721,202607210000001,100000,,給与,ﾘｸｾﾞﾝﾀｶﾀｼｶｲｹｲ,116975,
20260727,202607270000002,,57739,自払,JC ﾀﾞｲﾄｳﾔﾁﾝ,59236,
20260727,202607270000004,,3905,水道,水道料金,55331,`;

// 岩手銀行「通帳」の抜粋。1行目がヘッダーで、口座情報の説明行は無い。
const IWATE_SAMPLE = `年月日,お支払金額,お預かり金額,取引内容,差引残高,メモ
2023-02-19,,0,ｽﾏｰﾄﾂｳﾁﾖｳｷﾘｶｴ,,
2023-02-20,20000,,ATMｼﾊﾗｲ,44938,
2023-03-16,30000,,ﾓｸﾃｷﾖｷﾝﾌﾘｶｴ,14938,
2023-03-27,18000,,JC ﾀﾞｲﾄｳﾔﾁﾝ,-3062,
2026-06-17,1000,,RS ﾍﾟｲﾍﾟｲ,-4062,
2026-06-19,,80201,ﾘｸｾﾞﾝﾀｶﾀｼｶｲｹｲｶﾝﾘｼﾔ,76139,
2024-08-10,,3,ｹﾂｻﾝﾘｿｸ,76142,
2023-03-16,26400,,ﾌﾘｺﾐ,49742,`;

describe("parseBankCsv — ゆうちょ銀行", () => {
  const result = parseBankCsv(YUCHO_SAMPLE);

  it("フォーマットをyuchoと判定する", () => {
    expect(result.format).toBe("yucho");
  });

  it("ATM引出(カード)とPayPayチャージ(ＲＴ)を除外する", () => {
    expect(result.excludedCount).toBe(2);
    expect(result.transactions.some((t) => t.description.includes("PAYPAY"))).toBe(false);
  });

  it("給与を収入として取り込む", () => {
    const salary = result.transactions.find((t) => t.kind === "income");
    expect(salary).toBeDefined();
    expect(salary?.amount).toBe(100000);
    expect(salary?.description).toBe("ﾘｸｾﾞﾝﾀｶﾀｼｶｲｹｲ");
    expect(salary?.account).toBe("yucho");
  });

  it("家賃・水道を支出として取り込み、詳細2を摘要に使う", () => {
    const rent = result.transactions.find((t) => t.description === "JC ﾀﾞｲﾄｳﾔﾁﾝ");
    expect(rent?.amount).toBe(57739);
    expect(rent?.kind).toBe("expense");

    const water = result.transactions.find((t) => t.description === "水道料金");
    expect(water?.amount).toBe(3905);
  });

  it("残高の整合性が取れている", () => {
    expect(result.balanceMismatchCount).toBe(0);
  });
});

describe("parseBankCsv — 岩手銀行", () => {
  const result = parseBankCsv(IWATE_SAMPLE);

  it("フォーマットをiwateと判定する", () => {
    expect(result.format).toBe("iwate");
  });

  it("ATM引出・目的預金振替・PayPayチャージ・金額0の行を除外する", () => {
    // ATMｼﾊﾗｲ, ﾓｸﾃｷﾖｷﾝﾌﾘｶｴ, RS ﾍﾟｲﾍﾟｲ, ｽﾏｰﾄﾂｳﾁﾖｳｷﾘｶｴ(金額0) の4件
    expect(result.excludedCount).toBe(4);
  });

  it("給与・利息を収入として取り込む", () => {
    const incomes = result.transactions.filter((t) => t.kind === "income");
    expect(incomes.map((t) => t.amount).sort((a, b) => a - b)).toEqual([3, 80201]);
  });

  it("振込をisTransfer=trueとして取り込む(学習させない)", () => {
    const furikomi = result.transactions.find((t) => t.description === "ﾌﾘｺﾐ");
    expect(furikomi?.isTransfer).toBe(true);
    expect(furikomi?.amount).toBe(26400);
  });

  it("同一内容でも日付・残高からsourceRefが一意になる", () => {
    const refs = result.transactions.map((t) => t.sourceRef);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe("parseBankCsv — 未知の形式", () => {
  it("認識できないヘッダーはunknownを返す", () => {
    const result = parseBankCsv("a,b,c\n1,2,3\n");
    expect(result.format).toBe("unknown");
    expect(result.transactions).toHaveLength(0);
  });
});

describe("parseBankCsv — 残高の検算", () => {
  it("入出金と残高の差分が合わない行を検出する", () => {
    const broken = `年月日,お支払金額,お預かり金額,取引内容,差引残高,メモ
2026-01-01,1000,,ATMｼﾊﾗｲ,9000,
2026-01-02,,5000,ﾘｸｾﾞﾝﾀｶﾀｼｶｲｹｲｶﾝﾘｼﾔ,999999,`;
    const result = parseBankCsv(broken);
    expect(result.balanceMismatchCount).toBe(1);
  });
});
