import iconv from "iconv-lite";

/**
 * PayPayのCSVはUTF-8、銀行の通帳CSVはShift_JISで届く。
 * ファイルにエンコーディングの指定がないため、UTF-8として妥当かどうかを
 * ラウンドトリップで判定し、妥当でなければShift_JISとして読み直す。
 *
 * UTF-8として妥当なバイト列は再エンコードすると元のバイト列に戻るが、
 * Shift_JISのバイト列をUTF-8として誤読した場合は不正なバイト列を含むため
 * 置換文字が入り、ラウンドトリップが一致しなくなる。
 */
export function decodeCsvBuffer(buffer: Buffer): string {
  const asUtf8 = buffer.toString("utf-8");
  if (Buffer.from(asUtf8, "utf-8").equals(buffer)) {
    return stripBom(asUtf8);
  }
  return stripBom(iconv.decode(buffer, "Shift_JIS"));
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
