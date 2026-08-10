import styles from "./dashboard.module.css";
import {
  getAvailableYearMonths,
  getCategoryBreakdown,
  getLearnedCategories,
  getMonthSummary,
  getMonthlyTrend,
  getPendingTransactions,
  getRecentTransactions,
  resolveLineUserId,
} from "@/lib/dashboardData";
import { findDuplicateCandidates } from "@/lib/dedup";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/categories";
import { Transaction } from "@/lib/transactions";
import CategoryBarChart from "./CategoryBarChart";
import TrendChart from "./TrendChart";
import {
  confirmCategoryAction,
  deleteLearnedCategoryAction,
  deleteTransactionAction,
  resolveDuplicateAction,
  updateLearnedCategoryAction,
} from "./actions";

// 毎回最新のDB状態を読むダッシュボードのため、ビルド時の静的プリレンダリングは行わない
export const dynamic = "force-dynamic";

function currentJstYearMonth(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatYen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

function formatDate(isoString: string): string {
  const jst = new Date(new Date(isoString).getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <main className={styles.container}>
        <div className={styles.empty}>
          <p className={styles.title}>Supabaseが未設定です</p>
          <p>
            <code>SUPABASE_URL</code> / <code>SUPABASE_SERVICE_ROLE_KEY</code>{" "}
            を環境変数に設定すると、ダッシュボードが使えるようになります。README.mdの
            「必要なアカウント・APIキー」を参照してください。
          </p>
        </div>
      </main>
    );
  }

  const lineUserId = await resolveLineUserId();

  if (!lineUserId) {
    return (
      <main className={styles.container}>
        <div className={styles.empty}>
          <p className={styles.title}>まだデータがありません</p>
          <p>LINEでレシート写真や明細ファイル、金額のテキストを送ると、ここに集計が表示されます。</p>
        </div>
      </main>
    );
  }

  const availableMonths = await getAvailableYearMonths(lineUserId);
  const params = await searchParams;
  const yearMonth =
    params.month && /^\d{4}-\d{2}$/.test(params.month)
      ? params.month
      : (availableMonths[0] ?? currentJstYearMonth());

  const [summary, breakdown, trend, pending, recent, learned] = await Promise.all([
    getMonthSummary(lineUserId, yearMonth),
    getCategoryBreakdown(lineUserId, yearMonth),
    getMonthlyTrend(lineUserId, 6),
    getPendingTransactions(lineUserId),
    getRecentTransactions(lineUserId, 30),
    getLearnedCategories(lineUserId),
  ]);

  const monthOptions = availableMonths.includes(yearMonth)
    ? availableMonths
    : [yearMonth, ...availableMonths];

  const pendingWithCandidates = await Promise.all(
    pending.map(async (tx) => {
      if (tx.status !== "pending_duplicate") return { tx, candidate: null };
      const candidates = await findDuplicateCandidates({
        lineUserId,
        occurredAt: new Date(tx.occurredAt),
        amount: tx.amount,
        kind: tx.kind,
        excludeSource: tx.source,
      });
      return { tx, candidate: candidates[0] ?? null };
    })
  );

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>kakei</h1>
        <p className={styles.subtitle}>LINEで記録した収支の集計</p>
      </header>

      <nav className={styles.monthNav}>
        {monthOptions.map((m) => (
          <a
            key={m}
            href={`/?month=${m}`}
            className={`${styles.monthLink} ${m === yearMonth ? styles.monthLinkActive : ""}`}
          >
            {m}
          </a>
        ))}
      </nav>

      <section className={styles.statGrid}>
        <div className={styles.statTile}>
          <span className={styles.statLabel}>収入</span>
          <span className={styles.statValue}>{formatYen(summary.income)}</span>
        </div>
        <div className={styles.statTile}>
          <span className={styles.statLabel}>支出</span>
          <span className={styles.statValue}>{formatYen(summary.expense)}</span>
        </div>
        <div className={styles.statTile}>
          <span className={styles.statLabel}>収支</span>
          <span className={`${styles.statValue} ${summary.net < 0 ? styles.statValueNegative : ""}`}>
            {summary.net >= 0 ? "+" : ""}
            {formatYen(summary.net)}
          </span>
        </div>
      </section>

      {pendingWithCandidates.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>要確認</h2>
            <span className={styles.sectionMeta}>{pendingWithCandidates.length}件</span>
          </div>
          <div className={styles.pendingList}>
            {pendingWithCandidates.map(({ tx, candidate }) => (
              <PendingItem key={tx.id} tx={tx} candidate={candidate} />
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>カテゴリ別支出</h2>
          <span className={styles.sectionMeta}>{yearMonth}</span>
        </div>
        <div className={styles.card}>
          <CategoryBarChart data={breakdown.map((b) => ({ label: b.label, amount: b.amount }))} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>月別の収支推移</h2>
          <span className={styles.sectionMeta}>直近6か月</span>
        </div>
        <div className={styles.card}>
          <TrendChart data={trend} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>最近の取引</h2>
          <span className={styles.sectionMeta}>最新30件</span>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>日付</th>
                <th>収支</th>
                <th>店名・摘要</th>
                <th>カテゴリ</th>
                <th style={{ textAlign: "right" }}>金額</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td colSpan={6} className={styles.muted}>
                    まだ取引がありません
                  </td>
                </tr>
              )}
              {recent.map((t) => (
                <tr key={t.id}>
                  <td>{formatDate(t.occurredAt)}</td>
                  <td>
                    <span
                      className={`${styles.badge} ${t.kind === "income" ? styles.badgeIncome : styles.badgeExpense}`}
                    >
                      {t.kind === "income" ? "収入" : "支出"}
                    </span>
                  </td>
                  <td>{t.storeName ?? "—"}</td>
                  <td>{categoryLabelOf(t)}</td>
                  <td className="amount">{formatYen(t.amount)}</td>
                  <td>
                    <form action={deleteTransactionAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className={styles.button}>
                        削除
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>学習済みのカテゴリ</h2>
          <span className={styles.sectionMeta}>{learned.length}件</span>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>店名・摘要</th>
                <th>収支</th>
                <th>いつもの周期</th>
                <th>カテゴリ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {learned.length === 0 && (
                <tr>
                  <td colSpan={5} className={styles.muted}>
                    まだ学習したカテゴリがありません
                  </td>
                </tr>
              )}
              {learned.map((l) => (
                <tr key={l.id}>
                  <td>{l.storePattern}</td>
                  <td>
                    <span
                      className={`${styles.badge} ${l.kind === "income" ? styles.badgeIncome : styles.badgeExpense}`}
                    >
                      {l.kind === "income" ? "収入" : "支出"}
                    </span>
                  </td>
                  <td className={styles.muted}>{l.recurrence ?? "—"}</td>
                  <td>
                    <form action={updateLearnedCategoryAction} className={styles.inlineForm}>
                      <input type="hidden" name="id" value={l.id} />
                      <select
                        name="category"
                        defaultValue={l.category}
                        className={styles.select}
                      >
                        {(l.kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className={styles.button}>
                        変更
                      </button>
                    </form>
                  </td>
                  <td>
                    <form action={deleteLearnedCategoryAction}>
                      <input type="hidden" name="id" value={l.id} />
                      <button type="submit" className={styles.button}>
                        削除
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function categoryLabelOf(t: Transaction): string {
  if (!t.category) return "未分類";
  const all = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
  return all.find((c) => c.id === t.category)?.label ?? t.category;
}

function PendingItem({
  tx,
  candidate,
}: {
  tx: Transaction;
  candidate: { id: string; storeName: string | null; amount: number } | null;
}) {
  const categories = tx.kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <div className={styles.pendingItem}>
      <div className={styles.pendingInfo}>
        <span className={styles.pendingStore}>{tx.storeName ?? "（店名・摘要なし）"}</span>
        <span className={styles.pendingMeta}>
          {formatDate(tx.occurredAt)} ・ {tx.kind === "income" ? "収入" : "支出"} ・ {formatYen(tx.amount)}
        </span>
      </div>

      {tx.status === "pending_category" && (
        <form action={confirmCategoryAction} className={styles.inlineForm}>
          <input type="hidden" name="transactionId" value={tx.id} />
          <select name="category" className={styles.select} defaultValue="">
            <option value="" disabled>
              カテゴリを選択
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <button type="submit" className={`${styles.button} ${styles.buttonPrimary}`}>
            確定
          </button>
        </form>
      )}

      {tx.status === "pending_duplicate" && candidate && (
        <div className={styles.inlineForm}>
          <span className={styles.pendingMeta}>
            重複候補: {candidate.storeName ?? "店名不明"} / {formatYen(candidate.amount)}
          </span>
          <form action={resolveDuplicateAction}>
            <input type="hidden" name="transactionId" value={tx.id} />
            <input type="hidden" name="candidateId" value={candidate.id} />
            <input type="hidden" name="resolution" value="merge" />
            <button type="submit" className={styles.button}>
              まとめる
            </button>
          </form>
          <form action={resolveDuplicateAction}>
            <input type="hidden" name="transactionId" value={tx.id} />
            <input type="hidden" name="candidateId" value={candidate.id} />
            <input type="hidden" name="resolution" value="separate" />
            <button type="submit" className={`${styles.button} ${styles.buttonPrimary}`}>
              別々の取引として記録
            </button>
          </form>
        </div>
      )}

      <form action={deleteTransactionAction}>
        <input type="hidden" name="id" value={tx.id} />
        <button type="submit" className={styles.button}>
          削除
        </button>
      </form>
    </div>
  );
}
