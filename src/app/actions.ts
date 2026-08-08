"use server";

import { revalidatePath } from "next/cache";
import { getTransactionById, updateTransaction } from "@/lib/transactions";
import { saveLearnedCategory } from "@/lib/storeCategory";
import { isCategoryId, CategoryId } from "@/lib/categories";
import { getSupabaseServerClient } from "@/lib/supabase";

export async function confirmCategoryAction(formData: FormData): Promise<void> {
  const transactionId = String(formData.get("transactionId") ?? "");
  const category = String(formData.get("category") ?? "");
  if (!transactionId || !isCategoryId(category)) return;

  const tx = await getTransactionById(transactionId);
  await updateTransaction(transactionId, { category, status: "confirmed" });

  // 送金・振込は相手によって用途が毎回変わるため学習させない(LINE側の会話フローと同じ規則)
  if (tx && !tx.isTransfer && tx.storeName) {
    await saveLearnedCategory(tx.lineUserId, tx.storeName, category as CategoryId);
  }

  revalidatePath("/");
}

export async function resolveDuplicateAction(formData: FormData): Promise<void> {
  const transactionId = String(formData.get("transactionId") ?? "");
  const candidateId = String(formData.get("candidateId") ?? "");
  const resolution = String(formData.get("resolution") ?? "");
  if (!transactionId || !candidateId || (resolution !== "merge" && resolution !== "separate")) return;

  if (resolution === "merge") {
    await updateTransaction(transactionId, { status: "confirmed", duplicateOf: candidateId });
  } else {
    const tx = await getTransactionById(transactionId);
    await updateTransaction(transactionId, {
      status: tx?.category ? "confirmed" : "pending_category",
    });
  }

  revalidatePath("/");
}

export async function updateLearnedCategoryAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const category = String(formData.get("category") ?? "");
  if (!id || !isCategoryId(category)) return;

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("store_category_map")
    .update({ category, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;

  revalidatePath("/");
}

export async function deleteLearnedCategoryAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("store_category_map").delete().eq("id", id);
  if (error) throw error;

  revalidatePath("/");
}
