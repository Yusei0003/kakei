import { getSupabaseServerClient } from "@/lib/supabase";
import {
  Transaction,
  getTransactionById,
  updateTransaction,
} from "@/lib/transactions";
import { findDuplicateCandidates } from "@/lib/dedup";
import { getLearnedCategory, saveLearnedCategory } from "@/lib/storeCategory";
import { describeRecurrence } from "@/lib/recurrence";
import { CategoryId, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/categories";
import {
  categoryQuickReplyMessage,
  duplicateQuickReplyMessage,
} from "@/lib/line";

interface ConversationStateRow {
  line_user_id: string;
  pending_queue: string[];
  current_transaction_id: string | null;
  awaiting: "category" | "duplicate" | null;
}

async function loadState(lineUserId: string): Promise<ConversationStateRow> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("line_conversation_state")
    .select()
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (error) throw error;
  if (data) return data as ConversationStateRow;

  return {
    line_user_id: lineUserId,
    pending_queue: [],
    current_transaction_id: null,
    awaiting: null,
  };
}

async function saveState(state: ConversationStateRow): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("line_conversation_state").upsert(
    {
      line_user_id: state.line_user_id,
      pending_queue: state.pending_queue,
      current_transaction_id: state.current_transaction_id,
      awaiting: state.awaiting,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "line_user_id" }
  );
  if (error) throw error;
}

/** CSV/PDF取込などでまとめて発生した確認待ちの取引をキューへ積む */
export async function enqueuePending(
  lineUserId: string,
  transactionIds: string[]
): Promise<void> {
  if (transactionIds.length === 0) return;
  const state = await loadState(lineUserId);
  const existing = new Set([...state.pending_queue, state.current_transaction_id]);
  state.pending_queue.push(...transactionIds.filter((id) => !existing.has(id)));
  await saveState(state);
}

type QuickReplyMessage = ReturnType<typeof categoryQuickReplyMessage>;

/**
 * すでに回答待ちの質問がなければ、キューの先頭を取り出して次の質問を1件返す。
 * 回答待ち中や、キューが空なら何も返さない（呼び出し側はメッセージ配列が空のケースを許容すること）。
 */
export async function askNext(lineUserId: string): Promise<QuickReplyMessage[]> {
  const state = await loadState(lineUserId);

  if (state.current_transaction_id) {
    const current = await getTransactionById(state.current_transaction_id);
    if (current && current.status !== "confirmed") {
      return []; // まだ回答待ち
    }
    // 参照先が削除済み、または別経路(ダッシュボード等)で解決済み → 会話状態を修復して先へ進む
    state.current_transaction_id = null;
    state.awaiting = null;
  }

  while (state.pending_queue.length > 0) {
    const nextId = state.pending_queue.shift()!;
    const tx = await getTransactionById(nextId);
    if (!tx || tx.status === "confirmed") continue; // 既に別経路で解決済み

    if (tx.status === "pending_duplicate") {
      const candidates = await findDuplicateCandidates({
        lineUserId,
        occurredAt: new Date(tx.occurredAt),
        amount: tx.amount,
        kind: tx.kind,
        excludeSource: tx.source,
      });
      if (candidates.length === 0) {
        // 候補が消えていた（相手側が削除等）→ カテゴリ確認へフォールバック
        await updateTransaction(tx.id, { status: "pending_category" });
        state.pending_queue.unshift(nextId);
        await saveState(state);
        continue;
      }
      state.current_transaction_id = tx.id;
      state.awaiting = "duplicate";
      await saveState(state);
      return [
        duplicateQuickReplyMessage(
          `${formatTransactionLine(tx)}\nこれは既に記録済みの取引と同じものですか？（${candidates[0].storeName ?? "相手先不明"} / ${candidates[0].amount}円）`,
          tx.id,
          candidates[0].id
        ),
      ];
    }

    // pending_category
    state.current_transaction_id = tx.id;
    state.awaiting = "category";
    await saveState(state);
    const categories = tx.kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const hint = await buildRecurrenceHint(lineUserId, tx);
    return [
      categoryQuickReplyMessage(
        `${formatTransactionLine(tx)}${hint}\nカテゴリを選んでください`,
        tx.id,
        categories
      ),
    ];
  }

  await saveState(state);
  return [];
}

/**
 * 学習済みの摘要なのにカテゴリを聞いているということは、周期が「いつもと違う」と
 * 判定されたということ。何がいつもと違うのかを添えて確認しやすくする。
 */
async function buildRecurrenceHint(lineUserId: string, tx: Transaction): Promise<string> {
  if (tx.source !== "bank" || !tx.storeName) return "";

  const learned = await getLearnedCategory({
    lineUserId,
    storeName: tx.storeName,
    kind: tx.kind,
  });
  const description = describeRecurrence(learned?.pattern ?? null);
  if (!description) return "";

  return `\n※いつもと違います（通常は ${description}）`;
}

function formatTransactionLine(tx: Transaction): string {
  const date = new Date(tx.occurredAt);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
  const store = tx.storeName ? ` ${tx.storeName}` : "";
  const kindLabel = tx.kind === "income" ? "収入" : "支出";
  return `[${kindLabel}] ${dateStr}${store} ${tx.amount}円`;
}

export async function resolveCategory(
  lineUserId: string,
  transactionId: string,
  category: CategoryId
): Promise<void> {
  const state = await loadState(lineUserId);
  if (state.current_transaction_id !== transactionId) return; // 古いボタンの押し直しは無視

  const tx = await getTransactionById(transactionId);
  await updateTransaction(transactionId, { category, status: "confirmed" });

  // 送金・振込は相手によって用途が毎回変わるため学習させない
  if (tx && !tx.isTransfer && tx.storeName) {
    await saveLearnedCategory({
      lineUserId,
      storeName: tx.storeName,
      kind: tx.kind,
      category,
      // 銀行明細だけ周期（発生日・金額）も蓄積する
      recordRecurrence: tx.source === "bank",
      occurredAt: new Date(tx.occurredAt),
      amount: tx.amount,
    });
  }

  state.current_transaction_id = null;
  state.awaiting = null;
  await saveState(state);
}

export async function resolveDuplicate(
  lineUserId: string,
  transactionId: string,
  candidateId: string,
  resolution: "merge" | "separate"
): Promise<void> {
  const state = await loadState(lineUserId);
  if (state.current_transaction_id !== transactionId) return;

  if (resolution === "merge") {
    await updateTransaction(transactionId, {
      status: "confirmed",
      duplicateOf: candidateId,
    });
  } else {
    const tx = await getTransactionById(transactionId);
    const alreadyHasCategory = tx?.category != null;
    await updateTransaction(transactionId, {
      status: alreadyHasCategory ? "confirmed" : "pending_category",
    });
    if (!alreadyHasCategory) {
      // カテゴリ確認へ引き続き進めるためキューの先頭に戻す
      state.pending_queue.unshift(transactionId);
    }
  }

  state.current_transaction_id = null;
  state.awaiting = null;
  await saveState(state);
}
