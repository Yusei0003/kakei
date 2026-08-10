import { getSupabaseServerClient } from "@/lib/supabase";
import { CategoryId } from "@/lib/categories";
import {
  RecurrencePattern,
  isAnomalous,
  jstDayOfMonth,
  updateRecurrence,
} from "@/lib/recurrence";
// 型のみの参照なのでビルド時に消える（transactions.ts 側からこのファイルを読む循環にはならない）
import type { TransactionKind } from "@/lib/transactions";

/**
 * 店名の表記ゆれを吸収する簡易正規化。
 * 例: "セブン-イレブン - 陸前高田竹駒町" -> "セブン-イレブン"
 * PayPay/クレカ明細は「チェーン名 - 支店名」の形式が多いため、
 * " - " より前（チェーン名部分）だけを学習キーにする。
 * 銀行明細の摘要は支店名を持たないのでそのまま使われる。
 */
export function normalizeStoreName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const [chain] = trimmed.split(" - ");
  return chain.trim();
}

interface StoreCategoryRow {
  category: string;
  sample_count: number | null;
  day_min: number | null;
  day_max: number | null;
  amount_min: number | null;
  amount_max: number | null;
}

function rowToPattern(row: StoreCategoryRow): RecurrencePattern | null {
  if (
    row.sample_count == null ||
    row.day_min == null ||
    row.day_max == null ||
    row.amount_min == null ||
    row.amount_max == null
  ) {
    return null;
  }
  return {
    sampleCount: row.sample_count,
    dayMin: row.day_min,
    dayMax: row.day_max,
    amountMin: row.amount_min,
    amountMax: row.amount_max,
  };
}

export interface LearnedMatch {
  category: CategoryId;
  /** 銀行明細で、学習済みの周期・金額から大きく外れている場合に true */
  anomalous: boolean;
  pattern: RecurrencePattern | null;
}

/**
 * 学習済みカテゴリを引く。収入と支出は同じ摘要でも意味が変わるため、
 * kind まで含めて一致したものだけを返す。
 *
 * 銀行明細（checkRecurrence=true）の場合のみ、学習済みの周期と照らして
 * 「いつもと違う」かどうかも返す。コンビニのように日付も金額もばらつく
 * 決済で毎回確認が出ないよう、周期チェックは銀行明細に限定している。
 */
export async function getLearnedCategory(params: {
  lineUserId: string;
  storeName: string;
  kind: TransactionKind;
  checkRecurrence?: boolean;
  occurredAt?: Date;
  amount?: number;
}): Promise<LearnedMatch | null> {
  const pattern = normalizeStoreName(params.storeName);
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("store_category_map")
    .select("category, sample_count, day_min, day_max, amount_min, amount_max")
    .eq("line_user_id", params.lineUserId)
    .eq("store_pattern", pattern)
    .eq("kind", params.kind)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as StoreCategoryRow;
  const recurrence = rowToPattern(row);

  const anomalous =
    params.checkRecurrence === true && params.occurredAt != null && params.amount != null
      ? isAnomalous(recurrence, jstDayOfMonth(params.occurredAt), params.amount)
      : false;

  return { category: row.category as CategoryId, anomalous, pattern: recurrence };
}

/**
 * カテゴリの回答を学習する。銀行明細（recordRecurrence=true）の場合は
 * 発生日と金額も周期として蓄積し、次回以降「いつもと違う」判定に使う。
 */
export async function saveLearnedCategory(params: {
  lineUserId: string;
  storeName: string;
  kind: TransactionKind;
  category: CategoryId;
  recordRecurrence?: boolean;
  occurredAt?: Date;
  amount?: number;
}): Promise<void> {
  const pattern = normalizeStoreName(params.storeName);
  const supabase = getSupabaseServerClient();

  let recurrenceColumns: Record<string, number> | Record<string, never> = {};

  if (params.recordRecurrence === true && params.occurredAt != null && params.amount != null) {
    const { data, error: selectError } = await supabase
      .from("store_category_map")
      .select("category, sample_count, day_min, day_max, amount_min, amount_max")
      .eq("line_user_id", params.lineUserId)
      .eq("store_pattern", pattern)
      .eq("kind", params.kind)
      .maybeSingle();

    if (selectError) throw selectError;

    const prev = data ? rowToPattern(data as StoreCategoryRow) : null;
    const next = updateRecurrence(prev, jstDayOfMonth(params.occurredAt), params.amount);

    recurrenceColumns = {
      sample_count: next.sampleCount,
      day_min: next.dayMin,
      day_max: next.dayMax,
      amount_min: next.amountMin,
      amount_max: next.amountMax,
    };
  }

  const { error } = await supabase.from("store_category_map").upsert(
    {
      line_user_id: params.lineUserId,
      store_pattern: pattern,
      kind: params.kind,
      category: params.category,
      ...recurrenceColumns,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "line_user_id,store_pattern,kind" }
  );

  if (error) throw error;
}
