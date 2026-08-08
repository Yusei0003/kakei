import { getSupabaseServerClient } from "@/lib/supabase";
import { ExpenseSource } from "@/lib/expenses";

// 同じ買い物が「レシート写真で手動記録」→「後日PayPay CSVで再取込」のように
// 別ソース経由で二重登録されるのを防ぐための許容ウィンドウ。
// PayPay/クレカは決済日と記帳日がずれることがあるため多少の幅を持たせる。
const CROSS_SOURCE_WINDOW_DAYS = 2;

export interface DuplicateCandidate {
  id: string;
  occurredAt: string;
  amount: number;
  storeName: string | null;
  source: ExpenseSource;
}

/**
 * 金額が一致し、日付が近く、別ソースから来た既存の支出を「重複の可能性あり」として返す。
 * 同一ソース内の重複は expenses テーブルの unique(source, source_ref) 制約で別途弾いている。
 */
export async function findDuplicateCandidates(params: {
  lineUserId: string;
  occurredAt: Date;
  amount: number;
  excludeSource: ExpenseSource;
}): Promise<DuplicateCandidate[]> {
  const supabase = getSupabaseServerClient();

  const windowMs = CROSS_SOURCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const from = new Date(params.occurredAt.getTime() - windowMs).toISOString();
  const to = new Date(params.occurredAt.getTime() + windowMs).toISOString();

  const { data, error } = await supabase
    .from("expenses")
    .select("id, occurred_at, amount, store_name, source")
    .eq("line_user_id", params.lineUserId)
    .eq("amount", params.amount)
    .neq("source", params.excludeSource)
    .is("duplicate_of", null)
    .gte("occurred_at", from)
    .lte("occurred_at", to);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id as string,
    occurredAt: row.occurred_at as string,
    amount: row.amount as number,
    storeName: row.store_name as string | null,
    source: row.source as ExpenseSource,
  }));
}
