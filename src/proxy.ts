import { NextRequest, NextResponse } from "next/server";

// ダッシュボードは実際の収支データを表示するため、簡易的なBasic認証で保護する。
// LINEのWebhookと月次リマインドのCronは対象外
// （それぞれLINEの署名検証、CRON_SECRETによる認証を別途行っているため）。
export function proxy(req: NextRequest): NextResponse {
  const user = process.env.DASHBOARD_USERNAME;
  const pass = process.env.DASHBOARD_PASSWORD;

  if (!user || !pass) {
    // 未設定の間は認証をスキップする(ローカル開発用)。本番では必ず設定すること。
    return NextResponse.next();
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
    const separatorIndex = decoded.indexOf(":");
    const inputUser = decoded.slice(0, separatorIndex);
    const inputPass = decoded.slice(separatorIndex + 1);
    if (inputUser === user && inputPass === pass) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="kakei"' },
  });
}

export const config = {
  matcher: ["/((?!api/line/webhook|api/cron/|_next/static|_next/image|favicon.ico).*)"],
};
