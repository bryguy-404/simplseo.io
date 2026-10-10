"use client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

export default function SearchActivityChart({ daily }) {
  if (!daily.length) return <p className="text-sm text-muted-foreground py-4">No daily activity was returned for this period.</p>;
  return <div className="mt-4 space-y-3">
    <div className="h-56 w-full" aria-label="Daily appearances in Google search">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={daily} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.12} />
        <XAxis dataKey="date" tickFormatter={date => date.slice(5)} minTickGap={24} fontSize={12} />
        <YAxis allowDecimals={false} fontSize={12} />
        <Tooltip labelFormatter={date => `${date} · Pacific date`} contentStyle={{ backgroundColor: 'var(--background)', color: 'var(--foreground)', borderRadius: 8 }} />
        <Line type="linear" dataKey="impressions" name="Appearances" stroke="#00bf63" strokeWidth={2} dot={false} />
      </LineChart></ResponsiveContainer>
    </div>
    <p className="text-xs text-muted-foreground">Dates are shown exactly as reported by Google. Days without returned data are omitted.</p>
    <details><summary className="cursor-pointer text-sm">View daily numbers</summary><div className="max-h-64 overflow-auto mt-3"><table className="w-full text-sm"><caption className="sr-only">Daily Google Search Console activity, Pacific dates</caption><thead><tr><th className="text-left py-2" scope="col">Date</th><th scope="col" className="text-right">Clicks</th><th scope="col" className="text-right">Appearances</th></tr></thead><tbody>{daily.map(day => <tr key={day.date} className="border-t"><th scope="row" className="text-left font-normal py-2">{day.date}</th><td className="text-right">{day.clicks}</td><td className="text-right">{day.impressions}</td></tr>)}</tbody></table></div></details>
  </div>;
}
