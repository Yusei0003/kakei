import { getSupabaseServerClient } from "@/lib/supabase";
import { CategoryId, categoryLabel } from "@/lib/categories";
import { Transaction, TransactionKind, TransactionStatus } from "@/lib/transactions";
import { describeRecurrence } from "@/lib/recurrence";

interface TransactionRow {
  id: string;
  occurred_at: string;
  amount: number;
  kind: string;
  category: string | null;
  account: string | null;
  store_name: string | null;
  memo: string | null;
  source: string;
  source_ref: string | null;
  is_transfer: boolean;
  status: string;
  duplicate_of: string | null;
  line_user_id: string;
  created_at: string;
}

function rowToTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    amount: row.amount,
    kind: row.kind as TransactionKind,
    category: row.category as CategoryId | null,
    account: row.account as Transaction["account"],
    storeName: row.store_name,
    memo: row.memo,
    source: row.source as Transaction["source"],
    sourceRef: row.source_ref,
    isTransfer: row.is_transfer,
    status: row.status as TransactionStatus,
    duplicateOf: row.duplicate_of,
    lineUserId: row.line_user_id,
    createdAt: row.created_at,
  };
}

/**
 * 単一ユーザー運用のため、環境変数で指定が無ければ transactions テーブルに
 * 最初に現れたLINEユーザーIDを自動的に「本人」とみなす。
 */
export async function resolveLineUserId(): Promise<string | null> {
  if (process.env.DASHBOARD_LINE_USER_ID) return process.env.DASHBOARD_LINE_USER_ID;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("line_user_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data?.line_user_id as string | undefined) ?? null;
}

/** UTCのDateから、JSTの暦日を "YYYY-MM-DD" 形式で取り出す */
function jstDateParts(isoString: string): { year: number; month: number; day: number } {
  const jst = new Date(new Date(isoString).getTime() + 9 * 60 * 60 * 1000);
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1, day: jst.getUTCDate() };
}

function jstYearMonth(isoString: string): string {
  const { year, month } = jstDateParts(isoString);
  return `${year}-${String(month).padStart(2, "0")}`;
}

async function fetchConfirmedTransactions(lineUserId: string): Promise<Transaction[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("transactions")
    .select()
    .eq("line_user_id", lineUserId)
    .eq("status", "confirmed")
    .is("duplicate_of", null)
    .order("occurred_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => rowToTransaction(row as TransactionRow));
}

export interface MonthSummary {
  yearMonth: string;
  income: number;
  expense: number;
  net: number;
}

export async function getMonthSummary(lineUserId: string, yearMonth: string): Promise<MonthSummary> {
  const all = await fetchConfirmedTransactions(lineUserId);
  let income = 0;
  let expense = 0;
  for (const t of all) {
    if (jstYearMonth(t.occurredAt) !== yearMonth) continue;
    if (t.kind === "income") income += t.amount;
    else expense += t.amount;
  }
  return { yearMonth, income, expense, net: income - expense };
}

export interface CategoryBreakdownItem {
  category: CategoryId;
  label: string;
  amount: number;
}

export async function getCategoryBreakdown(
  lineUserId: string,
  yearMonth: string
): Promise<CategoryBreakdownItem[]> {
  const all = await fetchConfirmedTransactions(lineUserId);
  const totals = new Map<CategoryId, number>();

  for (const t of all) {
    if (t.kind !== "expense") continue;
    if (jstYearMonth(t.occurredAt) !== yearMonth) continue;
    if (!t.category) continue;
    totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
  }

  return [...totals.entries()]
    .map(([category, amount]) => ({ category, label: categoryLabel(category), amount }))
    .sort((a, b) => b.amount - a.amount);
}

export interface MonthlyTrendPoint {
  yearMonth: string;
  income: number;
  expense: number;
}

export async function getMonthlyTrend(lineUserId: string, months: number): Promise<MonthlyTrendPoint[]> {
  const all = await fetchConfirmedTransactions(lineUserId);
  const byMonth = new Map<string, { income: number; expense: number }>();

  for (const t of all) {
    const ym = jstYearMonth(t.occurredAt);
    const bucket = byMonth.get(ym) ?? { income: 0, expense: 0 };
    if (t.kind === "income") bucket.income += t.amount;
    else bucket.expense += t.amount;
    byMonth.set(ym, bucket);
  }

  const keys = lastNYearMonths(months);
  return keys.map((yearMonth) => ({
    yearMonth,
    income: byMonth.get(yearMonth)?.income ?? 0,
    expense: byMonth.get(yearMonth)?.expense ?? 0,
  }));
}

function lastNYearMonths(n: number): string[] {
  const now = new Date();
  const { year, month } = jstDateParts(now.toISOString());
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const total = year * 12 + (month - 1) - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return keys;
}

export async function getAvailableYearMonths(lineUserId: string): Promise<string[]> {
  const all = await fetchConfirmedTransactions(lineUserId);
  const set = new Set(all.map((t) => jstYearMonth(t.occurredAt)));
  return [...set].sort((a, b) => (a < b ? 1 : -1));
}

export async function getPendingTransactions(lineUserId: string): Promise<Transaction[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("transactions")
    .select()
    .eq("line_user_id", lineUserId)
    .neq("status", "confirmed")
    .order("occurred_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => rowToTransaction(row as TransactionRow));
}

export async function getRecentTransactions(lineUserId: string, limit: number): Promise<Transaction[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("transactions")
    .select()
    .eq("line_user_id", lineUserId)
    .eq("status", "confirmed")
    .is("duplicate_of", null)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => rowToTransaction(row as TransactionRow));
}

export interface LearnedCategoryRow {
  id: string;
  storePattern: string;
  kind: TransactionKind;
  category: CategoryId;
  categoryLabel: string;
  /** 銀行明細の固定費・定期収入で学習した周期。例: "毎月27日・57,739円" */
  recurrence: string | null;
}

export async function getLearnedCategories(lineUserId: string): Promise<LearnedCategoryRow[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("store_category_map")
    .select("id, store_pattern, kind, category, sample_count, day_min, day_max, amount_min, amount_max")
    .eq("line_user_id", lineUserId)
    .order("store_pattern", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => {
    const pattern =
      row.sample_count != null && row.day_min != null && row.amount_min != null
        ? {
            sampleCount: row.sample_count as number,
            dayMin: row.day_min as number,
            dayMax: row.day_max as number,
            amountMin: row.amount_min as number,
            amountMax: row.amount_max as number,
          }
        : null;

    return {
      id: row.id as string,
      storePattern: row.store_pattern as string,
      kind: row.kind as TransactionKind,
      category: row.category as CategoryId,
      categoryLabel: categoryLabel(row.category as CategoryId),
      recurrence: describeRecurrence(pattern),
    };
  });
}
