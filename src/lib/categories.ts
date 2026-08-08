export type ExpenseCategoryId =
  | "food"
  | "daily_goods"
  | "transport_car"
  | "communication"
  | "insurance"
  | "subscription"
  | "health"
  | "shopping"
  | "drinking"
  | "housing"
  | "utilities"
  | "loan"
  | "other";

export type IncomeCategoryId = "salary" | "honorarium" | "interest" | "other_income";

export type CategoryId = ExpenseCategoryId | IncomeCategoryId;

interface CategoryDef<T extends string> {
  id: T;
  label: string;
}

// LINEのクイックリプライは最大13項目までのため、支出はちょうど上限に収めている
export const EXPENSE_CATEGORIES: CategoryDef<ExpenseCategoryId>[] = [
  { id: "food", label: "食費" },
  { id: "daily_goods", label: "日用品" },
  { id: "transport_car", label: "交通費・車" },
  { id: "communication", label: "通信費" },
  { id: "insurance", label: "保険" },
  { id: "subscription", label: "サブスク・娯楽" },
  { id: "health", label: "医療・健康" },
  { id: "shopping", label: "通販・買い物" },
  { id: "drinking", label: "飲み会代" },
  { id: "housing", label: "家賃・住居費" },
  { id: "utilities", label: "水道光熱費" },
  { id: "loan", label: "ローン・奨学金返済" },
  { id: "other", label: "その他" },
];

export const INCOME_CATEGORIES: CategoryDef<IncomeCategoryId>[] = [
  { id: "salary", label: "給与" },
  { id: "honorarium", label: "謝金" },
  { id: "interest", label: "利息" },
  { id: "other_income", label: "その他" },
];

export const ALL_CATEGORIES: CategoryDef<CategoryId>[] = [
  ...EXPENSE_CATEGORIES,
  ...INCOME_CATEGORIES,
];

export function categoryLabel(id: CategoryId): string {
  return ALL_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function isCategoryId(value: string): value is CategoryId {
  return ALL_CATEGORIES.some((c) => c.id === value);
}

export function isExpenseCategoryId(value: string): value is ExpenseCategoryId {
  return EXPENSE_CATEGORIES.some((c) => c.id === value);
}

export function isIncomeCategoryId(value: string): value is IncomeCategoryId {
  return INCOME_CATEGORIES.some((c) => c.id === value);
}
