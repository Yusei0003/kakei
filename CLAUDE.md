@AGENTS.md

# kakei 作業メモ（セッション間の引き継ぎ用）

LINEにレシート・明細・テキストを送ると収支を記録し、Next.jsのダッシュボードで確認する個人用家計簿。
全体像は `README.md`、設計の詳細は `docs/DESIGN.md` を参照。

## 運用環境

- 本番: Vercel（https://kakei-pearl.vercel.app 、Basic認証あり）。`main` へのpushで自動デプロイ
- DB: Supabase。SQLはユーザーがSupabaseのSQL Editorで手動実行する
- LINE: Messaging API。Webhookは `/api/line/webhook`
- これまで `main` に直接pushしている
- このサンドボックスからはSupabase・Vercelのドメインに接続できない（プロキシが403を返す）。
  本番の動作確認はユーザーにブラウザやLINEで行ってもらう

## 開発時の確認

```bash
npx tsc --noEmit && npx eslint . && npx vitest run
```

## 直近の状況

- 最新の機能: 銀行明細の学習を収支別・周期対応にした（`src/lib/recurrence.ts`、
  `src/lib/storeCategory.ts`）。学習キーは `(line_user_id, store_pattern, kind)`
- **未完了の可能性あり**: `supabase/migrations/001_learning_kind_and_recurrence.sql` を
  本番DBで実行したかユーザーから確認が取れていない。未実行だと学習の読み書きが列不足でエラーになる。
  作業を始める前にユーザーに実行済みか確認すること
- 以前、Google Cloud Vision（レシートOCR）の設定を途中で中断している。続けるかは未確認
- 確定済み取引のカテゴリを編集する画面は無い（削除のみ）。要望があれば実装する

## ユーザーについて

- 日本語でやり取りする。専門用語は避け、設定作業は画面の場所まで具体的に案内する
- 管理画面のスクリーンショットを送ってくれることが多い
