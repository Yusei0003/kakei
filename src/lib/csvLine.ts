/**
 * 引用符で囲まれたフィールド内のカンマ（例: "PayPayポイント (5円), PayPay残高 (370円)"）
 * を壊さずに1行をカラム配列へ分解する、依存ライブラリ不要の簡易CSVパーサー。
 */
export function parseCsvLine(line: string): string[] {
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
