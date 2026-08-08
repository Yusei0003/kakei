import { getSupabaseServerClient } from "@/lib/supabase";
import { CategoryId } from "@/lib/categories";

/**
 * 店名の表記ゆれを吸収する簡易正規化。
 * 例: "セブン-イレブン - 陸前高田竹駒町" -> "セブン-イレブン"
 * PayPay/クレカ明細は「チェーン名 - 支店名」の形式が多いため、
 * " - " より前（チェーン名部分）だけを学習キーにする。
 */
export function normalizeStoreName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const [chain] = trimmed.split(" - ");
  return chain.trim();
}

export async function getLearnedCategory(
  lineUserId: string,
  storeName: string
): Promise<CategoryId | null> {
  const pattern = normalizeStoreName(storeName);
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("store_category_map")
    .select("category")
    .eq("line_user_id", lineUserId)
    .eq("store_pattern", pattern)
    .maybeSingle();

  if (error) throw error;
  return (data?.category as CategoryId | undefined) ?? null;
}

export async function saveLearnedCategory(
  lineUserId: string,
  storeName: string,
  category: CategoryId
): Promise<void> {
  const pattern = normalizeStoreName(storeName);
  const supabase = getSupabaseServerClient();

  const { error } = await supabase.from("store_category_map").upsert(
    {
      line_user_id: lineUserId,
      store_pattern: pattern,
      category,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "line_user_id,store_pattern" }
  );

  if (error) throw error;
}
