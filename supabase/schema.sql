-- kakei: LINE経由の家計管理システム DBスキーマ
-- Supabaseの SQL Editor でそのまま実行してください。

create extension if not exists "pgcrypto";

-- 支出カテゴリは固定リストで運用する（アプリ側 src/lib/categories.ts と同期させること）
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null,
  amount integer not null check (amount > 0),
  category text check (
    category in (
      'food', 'daily_goods', 'transport_car', 'communication',
      'insurance', 'subscription', 'health', 'shopping',
      'drinking', 'other'
    )
  ),
  store_name text,
  memo text,
  -- レシート写真は解析後に破棄する運用のため画像自体は保存しない
  source text not null check (source in ('receipt', 'manual', 'paypay', 'credit_card')),
  -- PayPayの取引番号やクレカ明細の行ハッシュ。同一ソースの再取込を弾くための一意キー
  source_ref text,
  -- 個人間送金は店名学習の対象外にし、毎回カテゴリを聞く
  is_transfer boolean not null default false,
  status text not null default 'pending_category' check (
    status in ('pending_category', 'pending_duplicate', 'confirmed')
  ),
  -- 重複と確定した場合、残す方のレコードを指す（自分自身は非表示扱いにする）
  duplicate_of uuid references expenses(id),
  line_user_id text not null,
  created_at timestamptz not null default now()
);

-- 同一ソースからの重複取込を防ぐ（例: 同じPayPay CSVを2回送った場合）
create unique index if not exists expenses_source_ref_unique
  on expenses (source, source_ref)
  where source_ref is not null;

create index if not exists expenses_occurred_at_idx on expenses (occurred_at);
create index if not exists expenses_status_idx on expenses (status);
create index if not exists expenses_line_user_id_idx on expenses (line_user_id);

-- 店名 → カテゴリの学習テーブル。一度LINEで回答されたら以後は自動適用する
create table if not exists store_category_map (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  -- 正規化した店名（例: "セブン-イレブン - 陸前高田竹駒町" -> "セブンイレブン"）
  store_pattern text not null,
  category text not null check (
    category in (
      'food', 'daily_goods', 'transport_car', 'communication',
      'insurance', 'subscription', 'health', 'shopping',
      'drinking', 'other'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists store_category_map_unique
  on store_category_map (line_user_id, store_pattern);

-- LINE上での「カテゴリを選んでください」「重複ですか？」という一問一答を
-- 順番に処理するための会話状態。ユーザーごとに1レコード。
create table if not exists line_conversation_state (
  line_user_id text primary key,
  -- 確認待ちのexpenses.idを順番に並べたキュー
  pending_queue jsonb not null default '[]'::jsonb,
  -- 現在ユーザーに質問中のexpenses.id
  current_expense_id uuid references expenses(id),
  -- 何を聞いているか: 'category' | 'duplicate'
  awaiting text check (awaiting in ('category', 'duplicate')),
  updated_at timestamptz not null default now()
);
