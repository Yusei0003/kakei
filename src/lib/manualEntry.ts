import { CategoryId } from "@/lib/categories";

export interface ManualEntry {
  amount: number;
  memo: string;
  kind: "expense" | "income";
  /** kindがincomeで、キーワードからカテゴリまで一意に決まる場合 */
  explicitCategory?: CategoryId;
}

// テキストは既定では支出として解釈する。「謝金」という語を含む場合のみ、
// 現金で受け取る謝金を想定して収入(謝金)として記録する。
const INCOME_KEYWORDS: { keyword: string; category: CategoryId }[] = [
  { keyword: "謝金", category: "honorarium" },
];

// 「ランチ 800円」「800円 ランチ」「800」のような自由入力から金額を取り出す。
// 見つかった最初の数字を金額とみなし、残りをメモ（学習キーにも使う）として扱う。
export function parseManualEntryText(text: string): ManualEntry | null {
  const match = text.match(/([0-9][0-9,]*)\s*円?/);
  if (!match) return null;

  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const memo = text.replace(match[0], "").trim();

  const incomeMatch = INCOME_KEYWORDS.find((k) => text.includes(k.keyword));
  if (incomeMatch) {
    return { amount, memo, kind: "income", explicitCategory: incomeMatch.category };
  }

  return { amount, memo, kind: "expense" };
}
