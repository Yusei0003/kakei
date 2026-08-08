import { getSupabaseServerClient } from "@/lib/supabase";
import { CategoryId } from "@/lib/categories";
import { getLearnedCategory } from "@/lib/storeCategory";
import { findDuplicateCandidates } from "@/lib/dedup";

export type ExpenseSource = "receipt" | "manual" | "paypay" | "credit_card";
export type ExpenseStatus = "pending_category" | "pending_duplicate" | "confirmed";

export interface Expense {
  id: string;
  occurredAt: string;
  amount: number;
  category: CategoryId | null;
  storeName: string | null;
  memo: string | null;
  source: ExpenseSource;
  sourceRef: string | null;
  isTransfer: boolean;
  status: ExpenseStatus;
  duplicateOf: string | null;
  lineUserId: string;
  createdAt: string;
}

interface ExpenseRow {
  id: string;
  occurred_at: string;
  amount: number;
  category: string | null;
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

function rowToExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    amount: row.amount,
    category: row.category as CategoryId | null,
    storeName: row.store_name,
    memo: row.memo,
    source: row.source as ExpenseSource,
    sourceRef: row.source_ref,
    isTransfer: row.is_transfer,
    status: row.status as ExpenseStatus,
    duplicateOf: row.duplicate_of,
    lineUserId: row.line_user_id,
    createdAt: row.created_at,
  };
}

export interface NewExpenseCandidate {
  lineUserId: string;
  occurredAt: Date;
  amount: number;
  storeName?: string;
  memo?: string;
  source: ExpenseSource;
  sourceRef?: string;
  isTransfer?: boolean;
  /** レシート写真やLINEテキストなど、ユーザーがその場でカテゴリを指定した場合 */
  explicitCategory?: CategoryId;
}

export type InsertResult =
  | { outcome: "skipped_duplicate_source" }
  | { outcome: "inserted"; expense: Expense };

/**
 * 支出候補を1件登録する。
 * 優先順位: 重複疑いがあれば pending_duplicate、なければカテゴリ未確定なら
 * pending_category、両方クリアなら confirmed。
 * 同一ソースの再取込（source + source_ref重複）はDBのunique制約で弾かれるのでスキップ扱いにする。
 */
export async function insertExpenseCandidate(
  input: NewExpenseCandidate
): Promise<InsertResult> {
  const supabase = getSupabaseServerClient();

  let category: CategoryId | null = input.explicitCategory ?? null;
  if (!category && !input.isTransfer && input.storeName) {
    category = await getLearnedCategory(input.lineUserId, input.storeName);
  }

  const duplicates = await findDuplicateCandidates({
    lineUserId: input.lineUserId,
    occurredAt: input.occurredAt,
    amount: input.amount,
    excludeSource: input.source,
  });

  const status: ExpenseStatus =
    duplicates.length > 0
      ? "pending_duplicate"
      : category
        ? "confirmed"
        : "pending_category";

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      line_user_id: input.lineUserId,
      occurred_at: input.occurredAt.toISOString(),
      amount: input.amount,
      category,
      store_name: input.storeName ?? null,
      memo: input.memo ?? null,
      source: input.source,
      source_ref: input.sourceRef ?? null,
      is_transfer: input.isTransfer ?? false,
      status,
    })
    .select()
    .single();

  if (error) {
    // 同一ソースの重複取込（unique制約違反）はエラーではなく想定内のスキップとして扱う
    if (error.code === "23505") {
      return { outcome: "skipped_duplicate_source" };
    }
    throw error;
  }

  return { outcome: "inserted", expense: rowToExpense(data as ExpenseRow) };
}

export async function getExpenseById(id: string): Promise<Expense | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("expenses")
    .select()
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? rowToExpense(data as ExpenseRow) : null;
}

export async function updateExpense(
  id: string,
  patch: Partial<Pick<Expense, "category" | "status" | "duplicateOf">>
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("expenses")
    .update({
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.duplicateOf !== undefined ? { duplicate_of: patch.duplicateOf } : {}),
    })
    .eq("id", id);

  if (error) throw error;
}
