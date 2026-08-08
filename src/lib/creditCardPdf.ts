import { PDFParse } from "pdf-parse";

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
   * 一部のカード会社（確認済み: 楽天カード）はPDF内のフォントが特殊で、
   * pdf-parse等の標準的なテキスト抽出では文字が全く取れない。
   * その場合 true になるので、呼び出し側はCSV利用を案内するなどのフォールバックが必要。
   */
  extractionFailed: boolean;
}

// "2026/06/20 カメイ燃料代 本人* 1回払い 7,722 0 7,722 7,722 7,722 0" のような行から
// 日付・店名・利用金額（手数料や請求額ではなく最初の金額）を取り出す。
const ROW_PATTERN =
  /^(\d{4}\/\d{2}\/\d{2})\s+(.+?)\s+(?:\S*\*)\s+(\S+払い)\s+([\d,]+)/;

export async function parseCreditCardPdf(
  buffer: Buffer
): Promise<ParseCreditCardPdfResult> {
  const parser = new PDFParse({ data: buffer });
  const { text } = await parser.getText();

  const meaningfulChars = text.replace(/\s|--.*?--/g, "");
  if (meaningfulChars.length < 50) {
    // このPDFのフォントからは文字がほぼ取れていない = 既知の抽出不能パターン
    return { transactions: [], extractionFailed: true };
  }

  const transactions = parseCreditCardText(text);
  return { transactions, extractionFailed: transactions.length === 0 };
}

/** テキスト抽出後の行パースだけを切り出した純粋関数（テスト用にも使う） */
export function parseCreditCardText(text: string): CreditCardTransaction[] {
  const transactions: CreditCardTransaction[] = [];
  for (const line of text.split(/\r\n|\n/)) {
    const m = line.match(ROW_PATTERN);
    if (!m) continue;

    const [, dateStr, storeName, , amountStr] = m;
    const amount = Number(amountStr.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const [y, mo, d] = dateStr.split("/");
    const occurredAt = new Date(`${y}-${mo}-${d}T00:00:00+09:00`);

    transactions.push({
      occurredAt,
      amount,
      storeName: storeName.trim(),
      sourceRef: `${dateStr}_${storeName.trim()}_${amount}`,
    });
  }
  return transactions;
}
