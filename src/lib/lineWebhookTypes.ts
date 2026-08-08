// LINE Messaging API Webhookのペイロードのうち、このアプリで使う部分だけを最小限に定義する。
// 公式SDK(@line/bot-sdk)の生成型は複雑なため、必要な形だけ自前で持つ。

interface EventSource {
  type: "user" | "group" | "room";
  userId?: string;
}

interface TextMessageContent {
  type: "text";
  id: string;
  text: string;
}

interface ImageMessageContent {
  type: "image";
  id: string;
}

interface FileMessageContent {
  type: "file";
  id: string;
  fileName: string;
}

type MessageContent =
  | TextMessageContent
  | ImageMessageContent
  | FileMessageContent;

export interface LineMessageEvent {
  type: "message";
  replyToken: string;
  source: EventSource;
  message: MessageContent;
}

export interface LinePostbackEvent {
  type: "postback";
  replyToken: string;
  source: EventSource;
  postback: { data: string };
}

export type LineEvent =
  | LineMessageEvent
  | LinePostbackEvent
  | { type: string; replyToken?: string; source?: EventSource };

export interface LineWebhookBody {
  destination: string;
  events: LineEvent[];
}
