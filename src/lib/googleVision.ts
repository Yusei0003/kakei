// レシート画像からGoogle Cloud Vision API (無料枠: 月1,000件) でテキストを抽出し、
// 「合計」「小計」等のキーワード付近の金額を推定する。
// GOOGLE_CLOUD_VISION_API_KEY が未設定の間は呼び出し側でスキップすること。

export async function detectTextInImage(image: Buffer): Promise<string> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_CLOUD_VISION_API_KEY が設定されていません");
  }

  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: image.toString("base64") },
            features: [{ type: "TEXT_DETECTION" }],
          },
        ],
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Vision API error ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  const text: string | undefined =
    json.responses?.[0]?.fullTextAnnotation?.text;
  return text ?? "";
}

const TOTAL_KEYWORDS = ["合計", "ご利用金額", "お会計", "小計"];

/**
 * OCRテキストから合計金額を推定する簡易ロジック。
 * 「合計」等のキーワードと同じ行、または直後の行にある金額を優先し、
 * 見つからなければ本文中の最大の金額を採用する。
 */
export function extractTotalAmount(text: string): number | null {
  const lines = text.split(/\r\n|\n/);
  const amountPattern = /([0-9][0-9,]{2,})\s*円?/;

  for (let i = 0; i < lines.length; i++) {
    if (TOTAL_KEYWORDS.some((k) => lines[i].includes(k))) {
      for (const candidate of [lines[i], lines[i + 1] ?? ""]) {
        const m = candidate.match(amountPattern);
        if (m) {
          const amount = Number(m[1].replace(/,/g, ""));
          if (amount > 0) return amount;
        }
      }
    }
  }

  const allAmounts = [...text.matchAll(new RegExp(amountPattern, "g"))]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (allAmounts.length === 0) return null;
  return Math.max(...allAmounts);
}
