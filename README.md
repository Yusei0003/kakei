# kakei

LINEにレシート写真・PayPay/クレジットカードの明細ファイル・金額のテキストを送ると、
自動で家計簿として記録し、あとでダッシュボードでカテゴリ別・月別に確認できるようにするための個人用アプリです。

## できること（現時点）

- LINEに金額を含むテキストを送ると支出として記録（例: `ランチ 800円`）
- PayPayの取引履歴CSVを送ると、支払い・個人間送金のみを自動取り込み（チャージ・ポイント獲得は除外）
- 一度カテゴリを選んだ店は、次回以降そのカテゴリを自動適用（個人間送金は毎回確認）
- 日付・金額が近い取引を別ソース間の重複候補として検出し、LINEで確認
- レシート写真のOCR（Google Cloud Vision）とクレジットカード明細PDFの取り込みは、下記の「既知の制約」を参照

まだ未実装: ダッシュボード（Web画面での集計・グラフ表示、要確認リストの一覧編集）

## 必要なアカウント・APIキー

1. **LINE Developers**（https://developers.line.biz/）
   - Messaging APIのチャネルを新規作成
   - チャネルシークレット → `LINE_CHANNEL_SECRET`
   - チャネルアクセストークン（長期）を発行 → `LINE_CHANNEL_ACCESS_TOKEN`
   - Webhook URLに `https://<デプロイ先のドメイン>/api/line/webhook` を設定し、Webhookを有効化
   - 応答メッセージ（自動応答）はオフにしておく

2. **Supabase**（https://supabase.com/）
   - 新規プロジェクトを作成
   - SQL Editorで `supabase/schema.sql` の内容を実行してテーブルを作成
   - Settings > API から Project URL → `SUPABASE_URL`、service_role キー → `SUPABASE_SERVICE_ROLE_KEY`
   - service_role キーは強い権限を持つため、サーバー環境変数としてのみ設定し、絶対に公開しないこと

3. **Google Cloud Vision API**（レシート写真の自動読み取りに使用、任意）
   - Google Cloudでプロジェクトを作成しVision APIを有効化（無料枠: 月1,000件）
   - APIキーを発行 → `GOOGLE_CLOUD_VISION_API_KEY`
   - 未設定でもアプリは動作するが、レシート写真を送ると「テキストで金額を送ってください」という案内が返るだけになる

`.env.example` をコピーして `.env.local` を作成し、上記の値を設定してください。

```bash
cp .env.example .env.local
```

## 開発

```bash
npm install
npm run dev      # 開発サーバー起動
npm run test     # 単体テスト（CSV/PDFパーサー・OCR金額抽出ロジックなど）
npm run lint      # ESLint
npm run build     # 本番ビルド確認
```

## 既知の制約

### クレジットカード明細PDFについて

楽天カードの利用明細PDFで実際に検証したところ、PDF内のフォントが特殊で、
`pdf-parse` など標準的なテキスト抽出ライブラリでは文字がほとんど取得できませんでした
（同じ理由でOSの `pdftotext` 等でも同様に失敗する可能性が高いです）。

現状は抽出に失敗した場合、LINEに「CSV形式があればそちらを送ってください」と案内するだけに留めています。
カード会社によっては会員サイトからCSV形式でダウンロードできる場合があるので、まずはそちらを試してください。
テキスト抽出が可能なPDF形式であれば `src/lib/creditCardPdf.ts` のパーサーがそのまま使えます
（`src/lib/__tests__/creditCardPdf.test.ts` でロジック自体は検証済み）。

PDFでのテキスト抽出がどうしても難しい場合、レシート写真と同様にPDFの各ページを画像化して
Vision APIでOCRする方式への切り替えが次の選択肢になります。

### カテゴリ

`src/lib/categories.ts` に固定リストとして定義しています。追加・変更する場合は
`supabase/schema.sql` の `check` 制約も同時に更新してください。

## デプロイ

Vercelへのデプロイを想定しています。上記の環境変数をVercelのProject Settingsに設定し、
LINE DevelopersのWebhook URLをデプロイ後のURLに更新してください。
