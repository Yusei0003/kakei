// 銀行通帳のCSVをパースする。口座ごとに列構成が異なるため、ヘッダーの内容から
// 自動判別して振り分ける。文字コードはShift_JISのため、呼び出し側で
// decodeCsvBuffer() を通してからこの関数に渡すこと。
//
// ゆうちょ銀行「入出金明細」:
//   取引日,入出金明細ＩＤ,受入金額（円）,払出金額（円）,詳細１,詳細２,現在（貸付）高
//   日付は "20260707" 形式。ヘッダーの前に口座情報の説明行が数行入る。
//
// 岩手銀行「通帳」:
//   年月日,お支払金額,お預かり金額,取引内容,差引残高,メモ
//   日付は "2026-07-07" 形式。ヘッダーが1行目。
//
// どちらも大半の行はATM引出・PayPayチャージ等の内部移動で、家計の増減を伴わない。
// これらは除外し、残高列を使って前後の行との整合性をチェックする。

import { parseCsvLine } from "@/lib/csvLine";

export type BankAccount = "yucho" | "iwate";

export interface BankTransaction {
  occurredAt: Date;
  amount: number;
  kind: "expense" | "income";
  /** 摘要。店名学習のキーとしても使う */
  description: string;
  sourceRef: string;
  /** 振込など、相手が同じでも用途が毎回変わるため学習させないもの */
  isTransfer: boolean;
  account: BankAccount;
}

export interface ParseBankCsvResult {
  format: BankAccount | "unknown";
  transactions: BankTransaction[];
  /** ATM引出・PayPayチャージ等、内部移動として除外した件数 */
  excludedCount: number;
  unparsedLines: string[];
  /** 前後の残高が入出金額と整合しなかった行数。パース漏れの検知に使う */
  balanceMismatchCount: number;
}

interface RawBankRow {
  occurredAt: Date;
  amount: number;
  kind: "expense" | "income";
  description: string;
  sourceRef: string;
  isTransfer: boolean;
  excluded: boolean;
  balance: number | null;
}

export function parseBankCsv(text: string): ParseBankCsvResult {
  if (text.includes("入出金明細ＩＤ")) return parseYuchoCsv(text);
  if (text.includes("お支払金額") && text.includes("お預かり金額")) return parseIwateCsv(text);
  return { format: "unknown", transactions: [], excludedCount: 0, unparsedLines: [], balanceMismatchCount: 0 };
}

function parseYuchoCsv(text: string): ParseBankCsvResult {
  const lines = text.split(/\r\n|\n/);
  const headerIndex = lines.findIndex((l) => l.startsWith("取引日,"));
  if (headerIndex === -1) {
    return { format: "yucho", transactions: [], excludedCount: 0, unparsedLines: [], balanceMismatchCount: 0 };
  }
  const dataLines = lines.slice(headerIndex + 1).filter((l) => l.trim().length > 0);

  const rows: RawBankRow[] = [];
  const unparsedLines: string[] = [];

  for (const line of dataLines) {
    const cols = parseCsvLine(line);
    if (cols.length < 7) {
      unparsedLines.push(line);
      continue;
    }
    const [dateStr, txId, deposit, withdrawal, detail1, detail2, balanceStr] = cols;

    let occurredAt: Date;
    try {
      occurredAt = parseYyyymmdd(dateStr);
    } catch {
      unparsedLines.push(line);
      continue;
    }

    const { kind, amount } = classifyAmount(parseYenOrNull(deposit), parseYenOrNull(withdrawal));
    const d1 = detail1.trim();
    const d2 = detail2.trim();
    const description = d2 || d1;
    const patternExcluded = d1 === "カード" || d2.includes("PAYPAY");

    rows.push({
      occurredAt,
      amount,
      kind,
      description,
      sourceRef: txId.trim(),
      isTransfer: d1.includes("振込"),
      excluded: patternExcluded || amount <= 0,
      balance: parseYenOrNull(balanceStr),
    });
  }

  return finalizeRows("yucho", rows, unparsedLines);
}

function parseIwateCsv(text: string): ParseBankCsvResult {
  const lines = text.split(/\r\n|\n/);
  const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);

  const rows: RawBankRow[] = [];
  const unparsedLines: string[] = [];

  for (const line of dataLines) {
    const cols = parseCsvLine(line);
    if (cols.length < 5) {
      unparsedLines.push(line);
      continue;
    }
    const [dateStr, pay, deposit, content, balanceStr] = cols;

    let occurredAt: Date;
    try {
      occurredAt = parseYyyyMmDdDash(dateStr);
    } catch {
      unparsedLines.push(line);
      continue;
    }

    const { kind, amount } = classifyAmount(parseYenOrNull(deposit), parseYenOrNull(pay));
    const description = content.trim();
    const patternExcluded = /ATM|ﾍﾟｲﾍﾟｲ|PAYPAY|ﾌﾘｶｴ|ｷﾘｶｴ|ｶ-ﾄﾞ/.test(description);

    rows.push({
      occurredAt,
      amount,
      kind,
      description,
      sourceRef: `${dateStr}_${amount}_${description}_${balanceStr.trim()}`,
      isTransfer: description === "ﾌﾘｺﾐ",
      excluded: patternExcluded || amount <= 0,
      balance: parseYenOrNull(balanceStr),
    });
  }

  return finalizeRows("iwate", rows, unparsedLines);
}

/** 受入(deposit)側が正の金額なら収入、出金(withdrawal)側が正の金額なら支出とみなす */
function classifyAmount(
  depositAmount: number | null,
  withdrawalAmount: number | null
): { kind: "expense" | "income"; amount: number } {
  if (depositAmount !== null && depositAmount > 0) {
    return { kind: "income", amount: depositAmount };
  }
  if (withdrawalAmount !== null && withdrawalAmount > 0) {
    return { kind: "expense", amount: withdrawalAmount };
  }
  // 入出金どちらも無い行(通帳切替など)。amount<=0として呼び出し側で除外扱いにする
  return { kind: "expense", amount: 0 };
}

function finalizeRows(
  format: BankAccount,
  rows: RawBankRow[],
  unparsedLines: string[]
): ParseBankCsvResult {
  const transactions: BankTransaction[] = rows
    .filter((r) => !r.excluded)
    .map((r) => ({
      occurredAt: r.occurredAt,
      amount: r.amount,
      kind: r.kind,
      description: r.description,
      sourceRef: r.sourceRef,
      isTransfer: r.isTransfer,
      account: format,
    }));

  return {
    format,
    transactions,
    excludedCount: rows.filter((r) => r.excluded).length,
    unparsedLines,
    balanceMismatchCount: countBalanceMismatches(rows),
  };
}

/**
 * 前の行の残高に入出金を加減した値が、次の行の残高と一致するかを検算する。
 * 除外した行(ATM引出等)も家計簿上は無視するだけで実際の残高は動かしているため、
 * 除外前の全行を対象に検算する。残高が空欄の行はスキップし、直前に判明している
 * 残高と比較する。
 */
function countBalanceMismatches(rows: RawBankRow[]): number {
  let mismatches = 0;
  let lastKnownBalance: number | null = null;

  for (const row of rows) {
    if (lastKnownBalance !== null && row.balance !== null) {
      const expected: number = row.kind === "income" ? lastKnownBalance + row.amount : lastKnownBalance - row.amount;
      if (expected !== row.balance) mismatches += 1;
    }
    if (row.balance !== null) lastKnownBalance = row.balance;
  }

  return mismatches;
}

function parseYenOrNull(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  if (!/^\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

function parseYyyymmdd(value: string): Date {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`unexpected date format: ${value}`);
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid date: ${value}`);
  return date;
}

function parseYyyyMmDdDash(value: string): Date {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`unexpected date format: ${value}`);
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid date: ${value}`);
  return date;
}
