import { NextRequest, NextResponse } from "next/server";
import { resolveLineUserId } from "@/lib/dashboardData";
import { pushMessage, textMessage } from "@/lib/line";

// Vercel Cron Jobsから毎月1日 09:00 JST に呼ばれ、今月分の明細を送るようLINEでリマインドする。
// vercel.json の crons 設定と対になっている。
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const lineUserId = await resolveLineUserId();
  if (!lineUserId) {
    // まだ一度もLINEでやり取りしていない場合は送りようがないのでスキップ
    return NextResponse.json({ skipped: "no line user yet" });
  }

  await pushMessage(lineUserId, [
    textMessage(
      "📅 月初のリマインドです。今月分の明細を送ってください。\n\n" +
        "・岩手銀行の通帳CSV\n" +
        "・ゆうちょ銀行の通帳CSV\n" +
        "・楽天カードの利用明細PDF\n" +
        "・PayPayの取引履歴CSV"
    ),
  ]);

  return NextResponse.json({ ok: true });
}
