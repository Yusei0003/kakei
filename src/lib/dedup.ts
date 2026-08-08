import { getSupabaseServerClient } from "@/lib/supabase";
import { TransactionKind, TransactionSource } from "@/lib/transactions";

// 同じ買い物が「レシート写真で手動記録」→「後日PayPay CSVで再取込」のように
// 別ソース経由で二重登録されるのを防ぐための許容ウィンドウ。
// PayPay/クレカは決済日と記帳日がずれることがあるため多少の幅を持たせる。
const CROSS_SOURCE_WINDOW_DAYS = 2;

export interface DuplicateCandidate {
  id: string;
  occurredAt: string;
  amount: number;
  storeName: string | null;
  source: TransactionSource;
}

/**
 * 金額・収支の別が一致し、日付が近く、別ソースから来た既存の取引を
 * 「重複の可能性あり」として返す。
 * 同一ソース内の重複は transactions テーブルの unique(source, source_ref) 制約で別途弾いている。
 *
 * 制約: 同じ「source」の値を共有する別々の実口座（例: ゆうちょ銀行と岩手銀行を
 * どちらも source='bank' で取り込む場合）については、この関数は互いを比較対象から
 * 除外してしまうため、口座をまたいだ偶然の一致は検出できない。今のところ実害は
 * 小さいと判断し許容している。
 */
export async function findDuplicateCandidates(params: {
  lineUserId: string;
  occurredAt: Date;
  amount: number;
  kind: TransactionKind;
  excludeSource: TransactionSource;
}): Promise<DuplicateCandidate[]> {
  const supabase = getSupabaseServerClient();

  const windowMs = CROSS_SOURCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const from = new Date(params.occurredAt.getTime() - windowMs).toISOString();
  const to = new Date(params.occurredAt.getTime() + windowMs).toISOString();

  const { data, error } = await supabase
    .from("transactions")
    .select("id, occurred_at, amount, store_name, source")
    .eq("line_user_id", params.lineUserId)
    .eq("amount", params.amount)
    .eq("kind", params.kind)
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
    source: row.source as TransactionSource,
  }));
}
