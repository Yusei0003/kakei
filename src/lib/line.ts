import crypto from "node:crypto";
import { CategoryId } from "@/lib/categories";

export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    throw new Error("LINE_CHANNEL_SECRET が設定されていません");
  }
  if (!signature) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  // タイミング攻撃対策で長さを揃えてから定数時間比較する
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface LineQuickReplyAction {
  type: "postback";
  label: string;
  data: string;
  displayText: string;
}

interface LineMessage {
  type: "text";
  text: string;
  quickReply?: {
    items: { type: "action"; action: LineQuickReplyAction }[];
  };
}

export function replyMessage(replyToken: string, messages: LineMessage[]): Promise<void> {
  return callLineApi("https://api.line.me/v2/bot/message/reply", {
    replyToken,
    messages,
  });
}

export function pushMessage(to: string, messages: LineMessage[]): Promise<void> {
  return callLineApi("https://api.line.me/v2/bot/message/push", {
    to,
    messages,
  });
}

async function callLineApi(url: string, body: unknown): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN が設定されていません");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE API error ${res.status}: ${text}`);
  }
}

export async function fetchMessageContent(messageId: string): Promise<Buffer> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN が設定されていません");
  }

  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`LINEコンテンツ取得エラー ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

export function textMessage(text: string): LineMessage {
  return { type: "text", text };
}

/** categoriesは支出用・収入用のどちらか一方を呼び出し側(kindに応じて)渡すこと */
export function categoryQuickReplyMessage(
  text: string,
  transactionId: string,
  categories: { id: CategoryId; label: string }[]
): LineMessage {
  return {
    type: "text",
    text,
    quickReply: {
      items: categories.map((c) => ({
        type: "action",
        action: {
          type: "postback",
          label: c.label,
          data: `action=category&transactionId=${transactionId}&category=${c.id}`,
          displayText: c.label,
        },
      })),
    },
  };
}

export function duplicateQuickReplyMessage(
  text: string,
  transactionId: string,
  duplicateCandidateId: string
): LineMessage {
  return {
    type: "text",
    text,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "重複としてまとめる",
            data: `action=duplicate&transactionId=${transactionId}&candidateId=${duplicateCandidateId}&resolution=merge`,
            displayText: "重複としてまとめる",
          },
        },
        {
          type: "action",
          action: {
            type: "postback",
            label: "別々の取引として記録",
            data: `action=duplicate&transactionId=${transactionId}&candidateId=${duplicateCandidateId}&resolution=separate`,
            displayText: "別々の取引として記録",
          },
        },
      ],
    },
  };
}
