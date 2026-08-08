import * as mupdf from "mupdf";

export interface CreditCardTransaction {
  occurredAt: Date;
  amount: number;
  storeName: string;
  /** 行内容から生成した簡易ハッシュ。同一明細の再取込を弾くための取引参照キー */
  sourceRef: string;
}

export interface ParseCreditCardPdfResult {
  transactions: CreditCardTransaction[];
  /**
   * 文字が全く抽出できなかった場合にtrueになる。
   * 過去に pdf-parse (pdf.js系) では楽天カードの明細PDFから文字が取れないことがあったが、
   * mupdf に切り替えたところ問題なく抽出できることを確認済み。念のため残しているガード。
   */
  extractionFailed: boolean;
}

export async function parseCreditCardPdf(
  buffer: Buffer
): Promise<ParseCreditCardPdfResult> {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const lines: string[] = [];

  try {
    const pageCount = doc.countPages();
    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      const text = page.toStructuredText("preserve-whitespace").asText();
      lines.push(...text.split(/\r\n|\n/));
    }
  } finally {
    doc.destroy();
  }

  const meaningfulChars = lines.join("").replace(/\s/g, "");
  if (meaningfulChars.length < 50) {
    return { transactions: [], extractionFailed: true };
  }

  const transactions = parseCreditCardLines(lines);
  return { transactions, extractionFailed: transactions.length === 0 };
}

const DATE_LINE = /^(\d{4})\/(\d{2})\/(\d{2})$/;
const PAYER_LINE = /\*$/; // 例: "本人*" "ETC*"
const PAYMENT_METHOD_LINE = /払い$/; // 例: "1回払い"

/**
 * 楽天カードの明細PDFはテキスト抽出すると1項目1行になる。
 * 日付・店名・利用者・支払方法・利用金額...の5〜6行が1取引のまとまりとして並ぶ。
 *   2026/06/20
 *   カメイ燃料代
 *   本人*
 *   1回払い
 *         7,722   ← 利用金額（これだけ使う）
 *           0
 *         7,722
 *   ...
 * 日付行の直後2行が「支払者(*で終わる)」「支払方法(払いで終わる)」のパターンに
 * 一致する場合だけを取引行として扱うことで、ヘッダーの日付など無関係な行を除外する。
 */
export function parseCreditCardLines(lines: string[]): CreditCardTransaction[] {
  const transactions: CreditCardTransaction[] = [];

  for (let i = 0; i < lines.length - 4; i++) {
    const dateMatch = lines[i].trim().match(DATE_LINE);
    if (!dateMatch) continue;

    const storeName = lines[i + 1].trim();
    const payerLine = lines[i + 2].trim();
    const paymentMethodLine = lines[i + 3].trim();
    const amountLine = lines[i + 4].trim();

    if (!storeName || !PAYER_LINE.test(payerLine) || !PAYMENT_METHOD_LINE.test(paymentMethodLine)) {
      continue;
    }

    const amount = Number(amountLine.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const [, y, mo, d] = dateMatch;
    const occurredAt = new Date(`${y}-${mo}-${d}T00:00:00+09:00`);

    transactions.push({
      occurredAt,
      amount,
      storeName,
      sourceRef: `${y}${mo}${d}_${storeName}_${amount}`,
    });
  }

  return transactions;
}
