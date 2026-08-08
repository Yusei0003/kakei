import { createClient } from "@supabase/supabase-js";

// サーバー側（Webhook・ダッシュボードのAPIルート）専用。
// service roleキーはRLSを無視するため、クライアントに露出させず必ずサーバーでのみ使うこと。
export function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません（.env.local を確認してください）"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
