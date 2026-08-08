import { NextRequest, NextResponse } from "next/server";
import {
  fetchMessageContent,
  isCategoryId,
  replyMessage,
  textMessage,
  verifyLineSignature,
} from "@/lib/line";
import {
  LineEvent,
  LineMessageEvent,
  LinePostbackEvent,
  LineWebhookBody,
} from "@/lib/lineWebhookTypes";
import { insertExpenseCandidate } from "@/lib/expenses";
import { askNext, enqueuePending, resolveCategory, resolveDuplicate } from "@/lib/conversation";
import { parseManualEntryText } from "@/lib/manualEntry";
import { parsePaypayCsv } from "@/lib/paypayCsv";
import { parseCreditCardPdf } from "@/lib/creditCardPdf";
import { detectTextInImage, extractTotalAmount } from "@/lib/googleVision";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  if (!verifyLineSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as LineWebhookBody;

  // LINEは200を素早く返さないと再送してくるため、処理は待つが失敗は握りつぶしてログのみに留める
  await Promise.all(body.events.map((event) => handleEvent(event).catch((err) => {
    console.error("Failed to handle LINE event", err);
  })));

  return NextResponse.json({ ok: true });
}

async function handleEvent(event: LineEvent): Promise<void> {
  if (event.type === "message") {
    await handleMessageEvent(event as LineMessageEvent);
  } else if (event.type === "postback") {
    await handlePostbackEvent(event as LinePostbackEvent);
  }
  // follow/unfollow等は今は無視
}

async function handleMessageEvent(event: LineMessageEvent): Promise<void> {
  const lineUserId = event.source.userId;
  if (!lineUserId) return;

  switch (event.message.type) {
    case "text":
      await handleTextMessage(lineUserId, event.message.text, event.replyToken);
      return;
    case "image":
      await handleImageMessage(lineUserId, event.message.id, event.replyToken);
      return;
    case "file": {
      const fileMessage = event.message as { fileName: string; id: string };
      await handleFileMessage(lineUserId, fileMessage.id, fileMessage.fileName, event.replyToken);
      return;
    }
    default:
      await replyMessage(event.replyToken, [
        textMessage("対応していないメッセージ形式です。レシート写真・PayPay/クレカの明細ファイル・金額のテキストを送ってください。"),
      ]);
  }
}

async function handleTextMessage(
  lineUserId: string,
  text: string,
  replyToken: string
): Promise<void> {
  const entry = parseManualEntryText(text);
  if (!entry) {
    await replyMessage(replyToken, [
      textMessage("金額がわかりませんでした。「ランチ 800円」のように送ってください。"),
    ]);
    return;
  }

  const result = await insertExpenseCandidate({
    lineUserId,
    occurredAt: new Date(),
    amount: entry.amount,
    storeName: entry.memo || undefined,
    source: "manual",
  });

  if (result.outcome === "skipped_duplicate_source") {
    // 手動入力はsourceRefを持たないため通常発生しない
    return;
  }

  if (result.expense.status === "confirmed") {
    await replyMessage(replyToken, [
      textMessage(`記録しました: ${entry.amount}円${entry.memo ? ` (${entry.memo})` : ""}`),
    ]);
    return;
  }

  await enqueuePending(lineUserId, [result.expense.id]);
  const questions = await askNext(lineUserId);
  await replyMessage(replyToken, questions);
}

async function handleImageMessage(
  lineUserId: string,
  messageId: string,
  replyToken: string
): Promise<void> {
  if (!process.env.GOOGLE_CLOUD_VISION_API_KEY) {
    await replyMessage(replyToken, [
      textMessage(
        "レシート画像の自動読み取りはまだ設定されていません（GOOGLE_CLOUD_VISION_API_KEY未設定）。金額をテキストで送ってください（例: 800円 ランチ）。"
      ),
    ]);
    return;
  }

  const image = await fetchMessageContent(messageId);
  const text = await detectTextInImage(image);
  const amount = extractTotalAmount(text);

  if (!amount) {
    await replyMessage(replyToken, [
      textMessage("レシートの金額を読み取れませんでした。金額をテキストで送ってください。"),
    ]);
    return;
  }

  const result = await insertExpenseCandidate({
    lineUserId,
    occurredAt: new Date(),
    amount,
    source: "receipt",
  });

  if (result.outcome === "skipped_duplicate_source") return;

  await enqueuePending(lineUserId, [result.expense.id]);
  const questions = await askNext(lineUserId);
  await replyMessage(replyToken, [
    textMessage(`レシートから${amount}円を読み取りました。`),
    ...questions,
  ]);
}

async function handleFileMessage(
  lineUserId: string,
  messageId: string,
  fileName: string,
  replyToken: string
): Promise<void> {
  const content = await fetchMessageContent(messageId);
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".csv")) {
    const text = stripBom(content.toString("utf-8"));
    const { transactions, skippedCount, unparsedLines } = parsePaypayCsv(text);

    let confirmed = 0;
    const pendingIds: string[] = [];
    let skippedDuplicates = 0;

    for (const t of transactions) {
      const result = await insertExpenseCandidate({
        lineUserId,
        occurredAt: t.occurredAt,
        amount: t.amount,
        storeName: t.storeName,
        source: "paypay",
        sourceRef: t.sourceRef,
        isTransfer: t.isTransfer,
      });

      if (result.outcome === "skipped_duplicate_source") {
        skippedDuplicates += 1;
      } else if (result.expense.status === "confirmed") {
        confirmed += 1;
      } else {
        pendingIds.push(result.expense.id);
      }
    }

    await enqueuePending(lineUserId, pendingIds);
    const questions = await askNext(lineUserId);

    await replyMessage(replyToken, [
      textMessage(
        `PayPay明細を取り込みました。\n自動記録: ${confirmed}件\n確認が必要: ${pendingIds.length}件\n重複でスキップ: ${skippedDuplicates}件\n対象外（チャージ等）: ${skippedCount}件` +
          (unparsedLines.length > 0 ? `\n読み取れなかった行: ${unparsedLines.length}件` : "")
      ),
      ...questions,
    ]);
    return;
  }

  if (lower.endsWith(".pdf")) {
    const { transactions, extractionFailed } = await parseCreditCardPdf(content);

    if (extractionFailed) {
      await replyMessage(replyToken, [
        textMessage(
          "このPDFは文字情報が埋め込まれておらず自動解析できませんでした。カード会社のサイトでCSV形式のダウンロードがあればそちらをお送りください。"
        ),
      ]);
      return;
    }

    let confirmed = 0;
    const pendingIds: string[] = [];
    let skippedDuplicates = 0;

    for (const t of transactions) {
      const result = await insertExpenseCandidate({
        lineUserId,
        occurredAt: t.occurredAt,
        amount: t.amount,
        storeName: t.storeName,
        source: "credit_card",
        sourceRef: t.sourceRef,
      });

      if (result.outcome === "skipped_duplicate_source") {
        skippedDuplicates += 1;
      } else if (result.expense.status === "confirmed") {
        confirmed += 1;
      } else {
        pendingIds.push(result.expense.id);
      }
    }

    await enqueuePending(lineUserId, pendingIds);
    const questions = await askNext(lineUserId);

    await replyMessage(replyToken, [
      textMessage(
        `クレカ明細を取り込みました。\n自動記録: ${confirmed}件\n確認が必要: ${pendingIds.length}件\n重複でスキップ: ${skippedDuplicates}件`
      ),
      ...questions,
    ]);
    return;
  }

  await replyMessage(replyToken, [
    textMessage("対応していないファイル形式です。PayPayのCSV、またはクレジットカード明細のPDFを送ってください。"),
  ]);
}

async function handlePostbackEvent(event: LinePostbackEvent): Promise<void> {
  const lineUserId = event.source.userId;
  if (!lineUserId) return;

  const params = new URLSearchParams(event.postback.data);
  const action = params.get("action");
  const expenseId = params.get("expenseId");
  if (!action || !expenseId) return;

  let ack: string;

  if (action === "category") {
    const category = params.get("category");
    if (!category || !isCategoryId(category)) return;
    await resolveCategory(lineUserId, expenseId, category);
    ack = "カテゴリを記録しました。";
  } else if (action === "duplicate") {
    const candidateId = params.get("candidateId");
    const resolution = params.get("resolution");
    if (!candidateId || (resolution !== "merge" && resolution !== "separate")) return;
    await resolveDuplicate(lineUserId, expenseId, candidateId, resolution);
    ack = resolution === "merge" ? "重複としてまとめました。" : "別々の支出として記録しました。";
  } else {
    return;
  }

  const questions = await askNext(lineUserId);
  await replyMessage(event.replyToken, [textMessage(ack), ...questions]);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
