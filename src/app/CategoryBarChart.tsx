"use client";

import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveContainer } from "recharts";

export interface CategoryBarDatum {
  label: string;
  amount: number;
}

function formatYen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

export default function CategoryBarChart({ data }: { data: CategoryBarDatum[] }) {
  if (data.length === 0) {
    return <p style={{ color: "var(--ink-muted)", fontSize: 14 }}>この月の支出データはまだありません</p>;
  }

  const height = Math.max(120, data.length * 36 + 24);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--grid)" />
        <XAxis
          type="number"
          tickFormatter={(v: number) => v.toLocaleString("ja-JP")}
          stroke="var(--ink-muted)"
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: "var(--baseline)" }}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={104}
          stroke="var(--ink-muted)"
          fontSize={13}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          formatter={(value) => formatYen(Number(value))}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 13,
          }}
          labelStyle={{ color: "var(--ink)" }}
        />
        <Bar dataKey="amount" fill="var(--series-2)" radius={[0, 4, 4, 0]} maxBarSize={22}>
          <LabelList
            dataKey="amount"
            position="right"
            formatter={(value) => formatYen(Number(value))}
            style={{ fill: "var(--ink-secondary)", fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
