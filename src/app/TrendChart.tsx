"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TrendDatum {
  yearMonth: string;
  income: number;
  expense: number;
}

function formatMonthLabel(yearMonth: string): string {
  const [, m] = yearMonth.split("-");
  return `${Number(m)}月`;
}

function formatYen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

export default function TrendChart({ data }: { data: TrendDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="yearMonth"
          tickFormatter={formatMonthLabel}
          stroke="var(--ink-muted)"
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: "var(--baseline)" }}
        />
        <YAxis
          tickFormatter={(v: number) => v.toLocaleString("ja-JP")}
          stroke="var(--ink-muted)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          formatter={(value) => formatYen(Number(value))}
          labelFormatter={(label) => formatMonthLabel(String(label))}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 13,
          }}
          labelStyle={{ color: "var(--ink)" }}
        />
        <Legend
          formatter={(value: string) => (
            <span style={{ color: "var(--ink-secondary)", fontSize: 13 }}>
              {value === "income" ? "収入" : "支出"}
            </span>
          )}
        />
        <Bar dataKey="income" name="income" fill="var(--series-1)" radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expense" name="expense" fill="var(--series-2)" radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
