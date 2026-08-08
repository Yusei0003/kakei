import { getSupabaseServerClient } from "@/lib/supabase";
import {
  Expense,
  getExpenseById,
  updateExpense,
} from "@/lib/expenses";
import { findDuplicateCandidates } from "@/lib/dedup";
import { saveLearnedCategory } from "@/lib/storeCategory";
import { CategoryId } from "@/lib/categories";
import {
  categoryQuickReplyMessage,
  duplicateQuickReplyMessage,
} from "@/lib/line";

interface ConversationStateRow {
  line_user_id: string;
  pending_queue: string[];
  current_expense_id: string | null;
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
    current_expense_id: null,
    awaiting: null,
  };
}

async function saveState(state: ConversationStateRow): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("line_conversation_state").upsert(
    {
      line_user_id: state.line_user_id,
      pending_queue: state.pending_queue,
      current_expense_id: state.current_expense_id,
      awaiting: state.awaiting,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "line_user_id" }
  );
  if (error) throw error;
}

/** CSV/PDF取込などでまとめて発生した確認待ちの支出をキューへ積む */
export async function enqueuePending(
  lineUserId: string,
  expenseIds: string[]
): Promise<void> {
  if (expenseIds.length === 0) return;
  const state = await loadState(lineUserId);
  const existing = new Set([...state.pending_queue, state.current_expense_id]);
  state.pending_queue.push(...expenseIds.filter((id) => !existing.has(id)));
  await saveState(state);
}

type QuickReplyMessage = ReturnType<typeof categoryQuickReplyMessage>;

/**
 * すでに回答待ちの質問がなければ、キューの先頭を取り出して次の質問を1件返す。
 * 回答待ち中や、キューが空なら何も返さない（呼び出し側はメッセージ配列が空のケースを許容すること）。
 */
export async function askNext(lineUserId: string): Promise<QuickReplyMessage[]> {
  const state = await loadState(lineUserId);
  if (state.current_expense_id) return [];

  while (state.pending_queue.length > 0) {
    const nextId = state.pending_queue.shift()!;
    const expense = await getExpenseById(nextId);
    if (!expense || expense.status === "confirmed") continue; // 既に別経路で解決済み

    if (expense.status === "pending_duplicate") {
      const candidates = await findDuplicateCandidates({
        lineUserId,
        occurredAt: new Date(expense.occurredAt),
        amount: expense.amount,
        excludeSource: expense.source,
      });
      if (candidates.length === 0) {
        // 候補が消えていた（相手側が削除等）→ カテゴリ確認へフォールバック
        await updateExpense(expense.id, { status: "pending_category" });
        state.pending_queue.unshift(nextId);
        await saveState(state);
        continue;
      }
      state.current_expense_id = expense.id;
      state.awaiting = "duplicate";
      await saveState(state);
      return [
        duplicateQuickReplyMessage(
          `${formatExpenseLine(expense)}\nこれは既に記録済みの支出と同じものですか？（${candidates[0].storeName ?? "店名不明"} / ${candidates[0].amount}円）`,
          expense.id,
          candidates[0].id
        ),
      ];
    }

    // pending_category
    state.current_expense_id = expense.id;
    state.awaiting = "category";
    await saveState(state);
    return [
      categoryQuickReplyMessage(
        `${formatExpenseLine(expense)}\nカテゴリを選んでください`,
        expense.id
      ),
    ];
  }

  await saveState(state);
  return [];
}

function formatExpenseLine(expense: Expense): string {
  const date = new Date(expense.occurredAt);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
  const store = expense.storeName ? ` ${expense.storeName}` : "";
  return `${dateStr}${store} ${expense.amount}円`;
}

export async function resolveCategory(
  lineUserId: string,
  expenseId: string,
  category: CategoryId
): Promise<void> {
  const state = await loadState(lineUserId);
  if (state.current_expense_id !== expenseId) return; // 古いボタンの押し直しは無視

  const expense = await getExpenseById(expenseId);
  await updateExpense(expenseId, { category, status: "confirmed" });

  // 送金は相手によって用途が毎回変わるため学習させない
  if (expense && !expense.isTransfer && expense.storeName) {
    await saveLearnedCategory(lineUserId, expense.storeName, category);
  }

  state.current_expense_id = null;
  state.awaiting = null;
  await saveState(state);
}

export async function resolveDuplicate(
  lineUserId: string,
  expenseId: string,
  candidateId: string,
  resolution: "merge" | "separate"
): Promise<void> {
  const state = await loadState(lineUserId);
  if (state.current_expense_id !== expenseId) return;

  if (resolution === "merge") {
    await updateExpense(expenseId, {
      status: "confirmed",
      duplicateOf: candidateId,
    });
  } else {
    const expense = await getExpenseById(expenseId);
    const alreadyHasCategory = expense?.category != null;
    await updateExpense(expenseId, {
      status: alreadyHasCategory ? "confirmed" : "pending_category",
    });
    if (!alreadyHasCategory) {
      // カテゴリ確認へ引き続き進めるためキューの先頭に戻す
      state.pending_queue.unshift(expenseId);
    }
  }

  state.current_expense_id = null;
  state.awaiting = null;
  await saveState(state);
}
