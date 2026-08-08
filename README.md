# kakei

LINEにレシート写真・PayPay/クレジットカードの明細ファイル・金額のテキストを送ると、
自動で家計簿として記録し、あとでダッシュボードでカテゴリ別・月別に確認できるようにするための個人用アプリです。

## できること（現時点）

- LINEに金額を含むテキストを送ると支出として記録（例: `ランチ 800円`）
- PayPayの取引履歴CSVを送ると、支払い・個人間送金のみを自動取り込み（チャージ・ポイント獲得は除外）
- クレジットカード（楽天カード）の利用明細PDFを送ると、取引を自動取り込み（`mupdf`でテキスト抽出）
- 一度カテゴリを選んだ店は、次回以降そのカテゴリを自動適用（個人間送金は毎回確認）
- 日付・金額が近い取引を別ソース間の重複候補として検出し、LINEで確認
- レシート写真のOCR（Google Cloud Vision）は下記の「既知の制約」を参照

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

当初 `pdf-parse`（pdf.js系）で試したところ、楽天カードの明細PDFはフォントの都合で
文字がほとんど取得できませんでした。**MuPDFの公式Node.jsバインディング（`mupdf`）に
切り替えたところ問題なく抽出でき**、実際の明細PDF（2026年07月分、20取引・合計61,325円）で
1円のズレもなく一致することを確認済みです。

テキスト抽出後は1項目1行（日付→店名→支払者→支払方法→金額...の順）で並ぶ形式のため、
`src/lib/creditCardPdf.ts` の `parseCreditCardLines` は単一行の正規表現ではなく、
行のまとまり（ブロック）としてパースしています。楽天カード以外のカード会社のPDFでは
レイアウトが異なる可能性があるため、`extractionFailed`（文字がほぼ抽出できない場合）と
`transactions.length === 0`（抽出はできたが行の並びが想定と違う場合）の両方を
呼び出し側でチェックし、失敗時はLINEに「CSV形式があればそちらを」と案内しています。

### カテゴリ

`src/lib/categories.ts` に固定リストとして定義しています。追加・変更する場合は
`supabase/schema.sql` の `check` 制約も同時に更新してください。

## デプロイ

Vercelへのデプロイを想定しています。上記の環境変数をVercelのProject Settingsに設定し、
LINE DevelopersのWebhook URLをデプロイ後のURLに更新してください。
