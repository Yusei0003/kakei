export type CategoryId =
  | "food"
  | "daily_goods"
  | "transport_car"
  | "communication"
  | "insurance"
  | "subscription"
  | "health"
  | "shopping"
  | "drinking"
  | "other";

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "food", label: "食費" },
  { id: "daily_goods", label: "日用品" },
  { id: "transport_car", label: "交通費・車" },
  { id: "communication", label: "通信費" },
  { id: "insurance", label: "保険" },
  { id: "subscription", label: "サブスク・娯楽" },
  { id: "health", label: "医療・健康" },
  { id: "shopping", label: "通販・買い物" },
  { id: "drinking", label: "飲み会代" },
  { id: "other", label: "その他" },
];

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function isCategoryId(value: string): value is CategoryId {
  return CATEGORIES.some((c) => c.id === value);
}
