-- kakei: LINE経由の家計管理システム DBスキーマ
-- Supabaseの SQL Editor でそのまま実行してください。

create extension if not exists "pgcrypto";

-- カテゴリは支出13種・収入4種の固定リストで運用する
-- (アプリ側 src/lib/categories.ts と同期させること)
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null,
  amount integer not null check (amount > 0),
  -- 収支の別。カテゴリの選択肢はkindによって変わる（下のcheck制約を参照）
  kind text not null check (kind in ('expense', 'income')),
  category text check (
    category in (
      -- 支出13種
      'food', 'daily_goods', 'transport_car', 'communication',
      'insurance', 'subscription', 'health', 'shopping',
      'drinking', 'housing', 'utilities', 'loan', 'other',
      -- 収入4種
      'salary', 'honorarium', 'interest', 'other_income'
    )
  ),
  -- 資金の出所・決済手段。通帳CSVはヘッダーから判別した口座を入れる
  account text check (account in ('yucho', 'iwate', 'paypay', 'rakuten_card', 'cash')),
  store_name text,
  memo text,
  -- レシート写真は解析後に破棄する運用のため画像自体は保存しない
  source text not null check (source in ('receipt', 'manual', 'paypay', 'credit_card', 'bank')),
  -- PayPayの取引番号、通帳の明細ID、クレカ明細の行ハッシュ等。同一ソースの再取込を弾く一意キー
  source_ref text,
  -- 個人間送金・振込は店名学習の対象外にし、毎回カテゴリを聞く
  is_transfer boolean not null default false,
  status text not null default 'pending_category' check (
    status in ('pending_category', 'pending_duplicate', 'confirmed')
  ),
  -- 重複と確定した場合、残す方のレコードを指す（自分自身は非表示扱いにする）
  duplicate_of uuid references transactions(id),
  line_user_id text not null,
  created_at timestamptz not null default now()
);

-- 同一ソースからの重複取込を防ぐ（例: 同じCSVを2回送った場合）
create unique index if not exists transactions_source_ref_unique
  on transactions (source, source_ref)
  where source_ref is not null;

create index if not exists transactions_occurred_at_idx on transactions (occurred_at);
create index if not exists transactions_status_idx on transactions (status);
create index if not exists transactions_line_user_id_idx on transactions (line_user_id);
create index if not exists transactions_kind_idx on transactions (kind);

-- 店名 → カテゴリの学習テーブル。一度LINEで回答されたら以後は自動適用する
create table if not exists store_category_map (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  -- 正規化した店名（例: "セブン-イレブン - 陸前高田竹駒町" -> "セブン-イレブン"）
  store_pattern text not null,
  category text not null check (
    category in (
      'food', 'daily_goods', 'transport_car', 'communication',
      'insurance', 'subscription', 'health', 'shopping',
      'drinking', 'housing', 'utilities', 'loan', 'other',
      'salary', 'honorarium', 'interest', 'other_income'
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
  -- 確認待ちのtransactions.idを順番に並べたキュー
  pending_queue jsonb not null default '[]'::jsonb,
  -- 現在ユーザーに質問中のtransactions.id
  current_transaction_id uuid references transactions(id),
  -- 何を聞いているか: 'category' | 'duplicate'
  awaiting text check (awaiting in ('category', 'duplicate')),
  updated_at timestamptz not null default now()
);
