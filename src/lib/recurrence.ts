// 銀行明細の固定費・定期収入は「毎月だいたい同じ日に、だいたい同じ金額」で動く。
// その周期を学習データに記録しておき、いつもと大きく外れた取引だけ確認する。
//
// 判定は観測済みの範囲そのものを基準にする自己較正型にしている。家賃のように
// 毎月ぴったり同額のものは範囲が狭いままなので小さなズレでも検知できる一方、
// 給与のように金額も日付もばらつくものは範囲が自然に広がり、ほとんど発火しない。

export interface RecurrencePattern {
  sampleCount: number;
  dayMin: number;
  dayMax: number;
  amountMin: number;
  amountMax: number;
}

/** 日付のズレをこの日数までは許容する（範囲の外側にさらに持たせる余裕） */
const DAY_MARGIN = 3;

/**
 * 観測された日付の幅がこれを超えたら、その明細にとって日付は周期の手がかりに
 * ならないと判断して日付チェックを止める。月をまたぐ表記ゆれの誤検知も防ぐ。
 */
const DAY_SPREAD_LIMIT = 20;

/** 金額は観測範囲の下限×0.6〜上限×1.6 までを「いつもの範囲」とみなす */
const AMOUNT_LOW_FACTOR = 0.6;
const AMOUNT_HIGH_FACTOR = 1.6;

/** 1件しか実績が無いうちは「いつもと違う」を判断できないので、2件目以降から有効にする */
const MIN_SAMPLES_FOR_CHECK = 2;

/** 取引日時(UTC)からJSTでの「月内の日」を取り出す */
export function jstDayOfMonth(occurredAt: Date): number {
  return new Date(occurredAt.getTime() + 9 * 60 * 60 * 1000).getUTCDate();
}

export function updateRecurrence(
  prev: RecurrencePattern | null,
  day: number,
  amount: number
): RecurrencePattern {
  if (!prev) {
    return { sampleCount: 1, dayMin: day, dayMax: day, amountMin: amount, amountMax: amount };
  }
  return {
    sampleCount: prev.sampleCount + 1,
    dayMin: Math.min(prev.dayMin, day),
    dayMax: Math.max(prev.dayMax, day),
    amountMin: Math.min(prev.amountMin, amount),
    amountMax: Math.max(prev.amountMax, amount),
  };
}

/**
 * 学習済みの周期から見て、この取引が「いつもと違う」かどうか。
 * 日付・金額のどちらかが大きく外れていれば true。
 */
export function isAnomalous(
  pattern: RecurrencePattern | null,
  day: number,
  amount: number
): boolean {
  if (!pattern || pattern.sampleCount < MIN_SAMPLES_FOR_CHECK) return false;

  const daySpread = pattern.dayMax - pattern.dayMin;
  const dayAnomalous =
    daySpread <= DAY_SPREAD_LIMIT &&
    (day < pattern.dayMin - DAY_MARGIN || day > pattern.dayMax + DAY_MARGIN);

  const amountAnomalous =
    amount < pattern.amountMin * AMOUNT_LOW_FACTOR ||
    amount > pattern.amountMax * AMOUNT_HIGH_FACTOR;

  return dayAnomalous || amountAnomalous;
}

/** 「毎月27日ごろ・約57,739円」のような人間向けの説明 */
export function describeRecurrence(pattern: RecurrencePattern | null): string | null {
  if (!pattern) return null;

  const dayPart =
    pattern.dayMin === pattern.dayMax
      ? `毎月${pattern.dayMin}日`
      : `毎月${pattern.dayMin}〜${pattern.dayMax}日ごろ`;

  const amountPart =
    pattern.amountMin === pattern.amountMax
      ? `${pattern.amountMin.toLocaleString("ja-JP")}円`
      : `${pattern.amountMin.toLocaleString("ja-JP")}〜${pattern.amountMax.toLocaleString("ja-JP")}円`;

  return `${dayPart}・${amountPart}`;
}
