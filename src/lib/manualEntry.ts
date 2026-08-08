export interface ManualEntry {
  amount: number;
  memo: string;
}

// 「ランチ 800円」「800円 ランチ」「800」のような自由入力から金額を取り出す。
// 見つかった最初の数字を金額とみなし、残りをメモ（学習キーにも使う）として扱う。
export function parseManualEntryText(text: string): ManualEntry | null {
  const match = text.match(/([0-9][0-9,]*)\s*円?/);
  if (!match) return null;

  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const memo = text.replace(match[0], "").trim();
  return { amount, memo };
}
