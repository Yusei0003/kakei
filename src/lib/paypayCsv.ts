// PayPayの「取引履歴」エクスポートCSVをパースする。
// 列: 取引日,出金金額（円）,入金金額（円）,海外出金金額,通貨,変換レート（円）,
//     利用国,取引内容,取引先,取引方法,支払い区分,利用者,取引番号

export interface PaypayTransaction {
  occurredAt: Date;
  amount: number;
  storeName: string;
  sourceRef: string;
  /** true: 個人間送金（送った金額）、false: 通常の支払い */
  isTransfer: boolean;
}

export interface ParsePaypayCsvResult {
  transactions: PaypayTransaction[];
  /** チャージ・ポイント獲得など、支出として扱わないため除外した件数 */
  skippedCount: number;
  /** フォーマットが想定と違い解釈できなかった行（デバッグ用） */
  unparsedLines: string[];
}

const EXPENSE_KINDS = new Set(["支払い", "送った金額"]);

export function parsePaypayCsv(csvText: string): ParsePaypayCsvResult {
  const lines = csvText.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
  // 1行目はヘッダーなので読み飛ばす
  const dataLines = lines.slice(1);

  const transactions: PaypayTransaction[] = [];
  const unparsedLines: string[] = [];
  let skippedCount = 0;

  for (const line of dataLines) {
    const cols = parseCsvLine(line);
    if (cols.length < 13) {
      unparsedLines.push(line);
      continue;
    }

    const [
      dateStr,
      withdrawal,
      ,
      ,
      ,
      ,
      ,
      kind,
      counterparty,
      ,
      ,
      ,
      transactionId,
    ] = cols;

    if (!EXPENSE_KINDS.has(kind)) {
      // チャージ・ポイント獲得・入金 は支出ではないので除外
      skippedCount += 1;
      continue;
    }

    const amount = parseYen(withdrawal);
    if (amount === null) {
      unparsedLines.push(line);
      continue;
    }

    let occurredAt: Date;
    try {
      occurredAt = parseJstDateTime(dateStr);
    } catch {
      unparsedLines.push(line);
      continue;
    }

    transactions.push({
      occurredAt,
      amount,
      storeName: counterparty.trim(),
      sourceRef: transactionId.trim(),
      isTransfer: kind === "送った金額",
    });
  }

  return { transactions, skippedCount, unparsedLines };
}

function parseYen(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 ? n : null;
}

function parseJstDateTime(value: string): Date {
  const m = value
    .trim()
    .match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`unexpected date format: ${value}`);
  const [, y, mo, d, h, mi, se] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}+09:00`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid date: ${value}`);
  return date;
}

/**
 * 引用符で囲まれたフィールド内のカンマ（例: "PayPayポイント (5円), PayPay残高 (370円)"）
 * を壊さずに1行をカラム配列へ分解する、依存ライブラリ不要の簡易CSVパーサー。
 */
function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cols.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  cols.push(current);
  return cols;
}
