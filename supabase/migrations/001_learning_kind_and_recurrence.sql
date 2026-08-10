-- 既に稼働しているデータベース向けの移行スクリプト。
-- Supabaseの SQL Editor でそのまま実行してください（新規構築なら schema.sql だけでよい）。
--
-- 目的:
--   1. 学習テーブルに kind（収入/支出）を持たせ、同じ摘要でも収支の別で
--      別の学習として扱えるようにする
--   2. 銀行明細の固定費・定期収入の周期（日付と金額の範囲）を記録できるようにする

alter table store_category_map
  add column if not exists kind text,
  add column if not exists sample_count integer,
  add column if not exists day_min integer,
  add column if not exists day_max integer,
  add column if not exists amount_min integer,
  add column if not exists amount_max integer;

-- 既存行のkindを埋める。収入カテゴリと支出カテゴリは重複しないので
-- カテゴリだけから収支の別を確定できる
update store_category_map
set kind = case
  when category in ('salary', 'honorarium', 'interest', 'other_income') then 'income'
  else 'expense'
end
where kind is null;

alter table store_category_map
  alter column kind set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'store_category_map_kind_check'
  ) then
    alter table store_category_map
      add constraint store_category_map_kind_check check (kind in ('expense', 'income'));
  end if;
end $$;

-- 一意キーを (line_user_id, store_pattern) から kind を含む3列へ張り替える
drop index if exists store_category_map_unique;
create unique index if not exists store_category_map_unique
  on store_category_map (line_user_id, store_pattern, kind);
