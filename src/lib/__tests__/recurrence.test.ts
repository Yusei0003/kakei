import { describe, expect, it } from "vitest";
import {
  RecurrencePattern,
  describeRecurrence,
  isAnomalous,
  jstDayOfMonth,
  updateRecurrence,
} from "@/lib/recurrence";

/** 実データを順に食わせて周期を作る補助 */
function learn(samples: { day: number; amount: number }[]): RecurrencePattern {
  return samples.reduce<RecurrencePattern | null>(
    (acc, s) => updateRecurrence(acc, s.day, s.amount),
    null
  )!;
}

describe("jstDayOfMonth", () => {
  it("UTCではなくJSTの暦日を返す", () => {
    // 2026-07-26T15:00:00Z === 2026-07-27 00:00 JST
    expect(jstDayOfMonth(new Date("2026-07-26T15:00:00.000Z"))).toBe(27);
  });
});

describe("updateRecurrence", () => {
  it("観測した日付・金額の範囲を広げていく", () => {
    const pattern = learn([
      { day: 27, amount: 57739 },
      { day: 27, amount: 57739 },
      { day: 28, amount: 58000 },
    ]);
    expect(pattern).toEqual({
      sampleCount: 3,
      dayMin: 27,
      dayMax: 28,
      amountMin: 57739,
      amountMax: 58000,
    });
  });
});

describe("isAnomalous", () => {
  it("実績が1件だけのうちは判定しない", () => {
    const pattern = learn([{ day: 27, amount: 57739 }]);
    expect(isAnomalous(pattern, 3, 999999)).toBe(false);
  });

  it("家賃のように毎月一定のものは、いつも通りなら通す", () => {
    // JC ﾀﾞｲﾄｳﾔﾁﾝ 57,739円が毎月27日
    const pattern = learn([
      { day: 27, amount: 57739 },
      { day: 27, amount: 57739 },
    ]);
    expect(isAnomalous(pattern, 27, 57739)).toBe(false);
  });

  it("家賃がいつもと違う日に落ちたら検知する", () => {
    const pattern = learn([
      { day: 27, amount: 57739 },
      { day: 27, amount: 57739 },
    ]);
    expect(isAnomalous(pattern, 5, 57739)).toBe(true);
  });

  it("家賃が桁違いの金額になったら検知する", () => {
    const pattern = learn([
      { day: 27, amount: 57739 },
      { day: 27, amount: 57739 },
    ]);
    expect(isAnomalous(pattern, 27, 150000)).toBe(true);
  });

  it("水道料金の季節変動は許容する", () => {
    // 水道料金は毎月27日だが金額が季節で上下する
    const pattern = learn([
      { day: 27, amount: 3905 },
      { day: 27, amount: 2500 },
      { day: 27, amount: 6000 },
    ]);
    expect(isAnomalous(pattern, 27, 6500)).toBe(false);
    expect(isAnomalous(pattern, 27, 1800)).toBe(false);
  });

  it("給与のように日付も金額もばらつくものは、ほぼ発火しない", () => {
    // 陸前高田市会計管理者からの振込は日付も金額も大きくばらつく
    const pattern = learn([
      { day: 21, amount: 100000 },
      { day: 19, amount: 16600 },
      { day: 30, amount: 308743 },
      { day: 8, amount: 163881 },
    ]);
    // 日付の幅が広がると日付チェック自体を止めるので、多少ずれても通る
    expect(isAnomalous(pattern, 12, 75000)).toBe(false);
    expect(isAnomalous(pattern, 25, 250000)).toBe(false);
  });
});

describe("describeRecurrence", () => {
  it("毎月同じ日・同じ金額なら簡潔に表す", () => {
    const pattern = learn([
      { day: 27, amount: 57739 },
      { day: 27, amount: 57739 },
    ]);
    expect(describeRecurrence(pattern)).toBe("毎月27日・57,739円");
  });

  it("幅がある場合は範囲で表す", () => {
    const pattern = learn([
      { day: 27, amount: 3905 },
      { day: 28, amount: 6000 },
    ]);
    expect(describeRecurrence(pattern)).toBe("毎月27〜28日ごろ・3,905〜6,000円");
  });

  it("周期が無ければnullを返す", () => {
    expect(describeRecurrence(null)).toBeNull();
  });
});
