import { getSupabaseServerClient } from "@/lib/supabase";
import { CategoryId } from "@/lib/categories";
import { getLearnedCategory } from "@/lib/storeCategory";
import { findDuplicateCandidates } from "@/lib/dedup";

export type TransactionSource = "receipt" | "manual" | "paypay" | "credit_card" | "bank";
export type TransactionKind = "expense" | "income";
export type TransactionStatus = "pending_category" | "pending_duplicate" | "confirmed";
export type Account = "yucho" | "iwate" | "paypay" | "rakuten_card" | "cash";

export interface Transaction {
  id: string;
  occurredAt: string;
  amount: number;
  kind: TransactionKind;
  category: CategoryId | null;
  account: Account | null;
  storeName: string | null;
  memo: string | null;
  source: TransactionSource;
  sourceRef: string | null;
  isTransfer: boolean;
  status: TransactionStatus;
  duplicateOf: string | null;
  lineUserId: string;
  createdAt: string;
}

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
    account: row.account as Account | null,
    storeName: row.store_name,
    memo: row.memo,
    source: row.source as TransactionSource,
    sourceRef: row.source_ref,
    isTransfer: row.is_transfer,
    status: row.status as TransactionStatus,
    duplicateOf: row.duplicate_of,
    lineUserId: row.line_user_id,
    createdAt: row.created_at,
  };
}

export interface NewTransactionCandidate {
  lineUserId: string;
  occurredAt: Date;
  amount: number;
  kind: TransactionKind;
  storeName?: string;
  memo?: string;
  account?: Account;
  source: TransactionSource;
  sourceRef?: string;
  isTransfer?: boolean;
  /** レシート写真やLINEテキストなど、ユーザーがその場でカテゴリを指定した場合 */
  explicitCategory?: CategoryId;
}

export type InsertResult =
  | { outcome: "skipped_duplicate_source" }
  | { outcome: "inserted"; transaction: Transaction };

/**
 * 取引候補を1件登録する。
 * 優先順位: 重複疑いがあれば pending_duplicate、なければカテゴリ未確定なら
 * pending_category、両方クリアなら confirmed。
 * 同一ソースの再取込（source + source_ref重複）はDBのunique制約で弾かれるのでスキップ扱いにする。
 */
export async function insertTransactionCandidate(
  input: NewTransactionCandidate
): Promise<InsertResult> {
  const supabase = getSupabaseServerClient();

  let category: CategoryId | null = input.explicitCategory ?? null;
  if (!category && !input.isTransfer && input.storeName) {
    // 周期チェックは銀行明細のみ。コンビニ決済のように日付も金額もばらつくものに
    // 適用すると毎回「いつもと違う」になってしまうため
    const learned = await getLearnedCategory({
      lineUserId: input.lineUserId,
      storeName: input.storeName,
      kind: input.kind,
      checkRecurrence: input.source === "bank",
      occurredAt: input.occurredAt,
      amount: input.amount,
    });
    // いつもの周期から外れている銀行明細は自動確定せず、カテゴリ確認へ回す
    if (learned && !learned.anomalous) {
      category = learned.category;
    }
  }

  const duplicates = await findDuplicateCandidates({
    lineUserId: input.lineUserId,
    occurredAt: input.occurredAt,
    amount: input.amount,
    kind: input.kind,
    excludeSource: input.source,
  });

  const status: TransactionStatus =
    duplicates.length > 0
      ? "pending_duplicate"
      : category
        ? "confirmed"
        : "pending_category";

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      line_user_id: input.lineUserId,
      occurred_at: input.occurredAt.toISOString(),
      amount: input.amount,
      kind: input.kind,
      category,
      account: input.account ?? null,
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

  return { outcome: "inserted", transaction: rowToTransaction(data as TransactionRow) };
}

export async function getTransactionById(id: string): Promise<Transaction | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("transactions")
    .select()
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? rowToTransaction(data as TransactionRow) : null;
}

export async function updateTransaction(
  id: string,
  patch: Partial<Pick<Transaction, "category" | "status" | "duplicateOf">>
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("transactions")
    .update({
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.duplicateOf !== undefined ? { duplicate_of: patch.duplicateOf } : {}),
    })
    .eq("id", id);

  if (error) throw error;
}
