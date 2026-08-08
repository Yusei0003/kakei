import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { decodeCsvBuffer } from "@/lib/textEncoding";

describe("decodeCsvBuffer", () => {
  it("UTF-8のバイト列はそのままデコードする", () => {
    const buf = Buffer.from("取引日,金額\n2026/07/31,375\n", "utf-8");
    expect(decodeCsvBuffer(buf)).toBe("取引日,金額\n2026/07/31,375\n");
  });

  it("Shift_JISのバイト列を自動判定してデコードする", () => {
    const original = "年月日,お支払金額\n2026-07-07,220,,ATMｼﾊﾗｲ\n";
    const buf = iconv.encode(original, "Shift_JIS");
    expect(decodeCsvBuffer(buf)).toBe(original);
  });

  it("UTF-8のBOMを取り除く", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a,b\n", "utf-8")]);
    expect(decodeCsvBuffer(buf)).toBe("a,b\n");
  });
});
