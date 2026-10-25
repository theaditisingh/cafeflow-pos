import { useState } from 'react';
import { Download } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { qs } from '../util.js';
import {
  Button, Card, Input, Spinner, ErrorBox, Empty, Badge, PageHeader, Tabs, Table, Th, Td, useAsync, useUi, inr, fmtDateTime, istToday, istDaysAgo, titleCase,
} from '../ui.jsx';

const PRESETS = [['Today', 0, 0], ['Last 7 days', 6, 0], ['Last 30 days', 29, 0]];
const shortDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

export default function Reports() {
  const { toast } = useUi();
  const [tab, setTab] = useState('sales');
  const [range, setRange] = useState({ from: istDaysAgo(6), to: istToday() });
  const [draft, setDraft] = useState(range);
  const bad = draft.from > draft.to || !draft.from || !draft.to;

  const exportCsv = async (path, name) => {
    try { await api.download(`/reports/${path}?${qs({ ...range, format: 'csv' })}`, `${name}_${range.from}_to_${range.to}.csv`); }
    catch (e) { toast(e.message, 'error'); }
  };
  const csvBtn = (path, name) => <Button onClick={() => exportCsv(path, name)}><Download size={15} />Export CSV</Button>;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Reports" subtitle="Figures come from recorded orders and payments, in Indian Standard Time." />
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4 shadow-sm">
        <label className="text-xs font-semibold text-ink-2">From<Input type="date" max={draft.to} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className="mt-1 w-40" /></label>
        <label className="text-xs font-semibold text-ink-2">To<Input type="date" min={draft.from} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className="mt-1 w-40" /></label>
        <Button variant="primary" disabled={bad} onClick={() => setRange(draft)}>Apply</Button>
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          {PRESETS.map(([label, a, b]) => <Button key={label} size="sm" variant="ghost" className="border border-line/60 bg-cream-2/40 hover:bg-cream-2" onClick={() => { const r = { from: istDaysAgo(a), to: istDaysAgo(b) }; setDraft(r); setRange(r); }}>{label}</Button>)}
        </div>
        {bad && <span className="w-full text-xs font-medium text-rose">The start date must be on or before the end date.</span>}
      </Card>
      <Tabs value={tab} onChange={setTab} tabs={[['sales', 'Sales'], ['items', 'Items'], ['categories', 'Categories'], ['cancellations', 'Cancellations'], ['stock', 'Stock']]} />
      {tab === 'sales' && <Sales range={range} csvBtn={csvBtn('sales', 'sales')} />}
      {tab === 'items' && <Items range={range} csvBtn={csvBtn('items', 'items')} />}
      {tab === 'categories' && <Categories range={range} csvBtn={csvBtn('categories', 'categories')} />}
      {tab === 'cancellations' && <Cancellations range={range} csvBtn={csvBtn('cancellations', 'cancellations')} />}
      {tab === 'stock' && <Stock range={range} csvBtn={csvBtn('stock', 'stock_movements')} />}
    </div>
  );
}

const Stat = ({ label, value, hint, strong }) => (
  <Card className={cx('p-3.5 shadow-2xs transition-all duration-150 hover:shadow-sm', strong ? 'border-terra/40 bg-gradient-to-br from-white to-terra-l/25' : '')}>
    <div className="text-xs font-semibold text-ink-3">{label}</div>
    <div className={cx('mt-1 text-xl font-bold tracking-tight tnum', strong ? 'text-terra-d' : 'text-ink')}>{value}</div>
    {hint && <div className="mt-0.5 text-[11px] text-ink-3">{hint}</div>}
  </Card>
);
const Bar2 = ({ children }) => <div className="mb-3 flex justify-end">{children}</div>;

function Sales({ range, csvBtn }) {
  const { data, error, loading, reload } = useAsync(() => api.get(`/reports/sales?${qs(range)}`), [range.from, range.to]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { summary: s, daily, payments } = data;
  const payTotal = payments.reduce((a, p) => a + p.amountPaise, 0);
  return (
    <div className="space-y-4">
      <Bar2>{csvBtn}</Bar2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Gross sales" value={inr(s.grossSalesPaise)} hint="Before discounts, excl. tax" />
        <Stat label="Discounts" value={inr(s.discountPaise)} />
        <Stat label="Net sales" value={inr(s.netSalesPaise)} hint="After discounts, excl. tax" strong />
        <Stat label="Tax collected" value={inr(s.taxPaise)} hint="As configured in Settings" />
        <Stat label="Total collected" value={inr(s.totalCollectedPaise)} hint="Net sales + tax" />
        <Stat label="Refunds & voids" value={inr(s.refundsPaise)} hint={`${s.refundCount} payment${s.refundCount === 1 ? '' : 's'} · by refund date`} />
        <Stat label="Paid orders" value={s.orders} hint={`Avg ${inr(s.avgOrderValuePaise)}`} />
        <Stat label="Net after refunds" value={inr(s.netAfterRefundsPaise)} strong />
      </div>
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Net sales by day</h3>
        {daily.every((d) => d.orders === 0) ? <Empty title="No paid orders in this period" /> : (
          <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={daily.map((d) => ({ ...d, label: shortDate(d.date), net: d.netSalesPaise / 100 }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4dac8" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} width={56} tickFormatter={(v) => `₹${v}`} />
            <Tooltip formatter={(v) => [inr(Math.round(v * 100)), 'Net sales']} /><Bar dataKey="net" fill="#c0603c" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>)}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden"><h3 className="px-4 pt-3 text-sm font-semibold">Payment methods</h3>
          {!payments.length ? <Empty title="No payments in this period" /> : <Table><thead><tr><Th>Method</Th><Th right>Payments</Th><Th right>Amount</Th><Th right>Share</Th></tr></thead><tbody>
            {payments.map((p) => <tr key={p.method}><Td>{titleCase(p.method)}</Td><Td right>{p.count}</Td><Td right>{inr(p.amountPaise)}</Td><Td right>{payTotal ? Math.round((p.amountPaise / payTotal) * 100) : 0}%</Td></tr>)}</tbody></Table>}
          <p className="px-4 pb-3 text-[11px] text-ink-3">Payments recorded in this period, by payment date. Includes any later refunded.</p></Card>
        <Card className="overflow-hidden"><h3 className="px-4 pt-3 text-sm font-semibold">Daily detail</h3>
          <div className="max-h-72 overflow-y-auto"><Table><thead><tr><Th>Date</Th><Th right>Orders</Th><Th right>Discounts</Th><Th right>Net</Th><Th right>Tax</Th></tr></thead><tbody>
            {[...daily].reverse().map((d) => <tr key={d.date}><Td>{shortDate(d.date)}</Td><Td right>{d.orders}</Td><Td right>{inr(d.discountPaise)}</Td><Td right>{inr(d.netSalesPaise)}</Td><Td right>{inr(d.taxPaise)}</Td></tr>)}</tbody></Table></div></Card>
      </div>
    </div>
  );
}

function Items({ range, csvBtn }) {
  const { data, error, loading, reload } = useAsync(() => api.get(`/reports/items?${qs(range)}`), [range.from, range.to]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (<><Bar2>{csvBtn}</Bar2><Card className="overflow-hidden">{!data.length ? <Empty title="No items sold in this period" /> : (
    <Table><thead><tr><Th>Item</Th><Th right>Qty sold</Th><Th right>Net sales</Th><Th right>Discounts</Th><Th right>Tax</Th></tr></thead><tbody>
      {data.map((i) => <tr key={i.name}><Td className="font-medium">{i.name}</Td><Td right>{i.quantity}</Td><Td right>{inr(i.netSalesPaise)}</Td><Td right>{inr(i.discountPaise)}</Td><Td right>{inr(i.taxPaise)}</Td></tr>)}</tbody></Table>)}</Card></>);
}

function Categories({ range, csvBtn }) {
  const { data, error, loading, reload } = useAsync(() => api.get(`/reports/categories?${qs(range)}`), [range.from, range.to]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (<><Bar2>{csvBtn}</Bar2><Card className="overflow-hidden">{!data.length ? <Empty title="No sales in this period" /> : (
    <Table><thead><tr><Th>Category</Th><Th right>Qty sold</Th><Th right>Net sales</Th></tr></thead><tbody>
      {data.map((c) => <tr key={c.name}><Td className="font-medium">{c.name}</Td><Td right>{c.quantity}</Td><Td right>{inr(c.netSalesPaise)}</Td></tr>)}</tbody></Table>)}</Card></>);
}

function Cancellations({ range, csvBtn }) {
  const { data, error, loading, reload } = useAsync(() => api.get(`/reports/cancellations?${qs(range)}`), [range.from, range.to]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (<><Bar2>{csvBtn}</Bar2><Card className="overflow-hidden">{!data.length ? <Empty title="No cancelled orders in this period" /> : (
    <Table><thead><tr><Th>Order</Th><Th>Created</Th><Th>Type</Th><Th right>Value</Th><Th>Kitchen status</Th><Th>Reason</Th><Th>By</Th></tr></thead><tbody>
      {data.map((c) => <tr key={c.orderNumber}><Td className="font-medium">{c.orderNumber}</Td><Td>{fmtDateTime(c.createdAt)}</Td><Td>{titleCase(c.type)}</Td><Td right>{inr(c.totalPaise)}</Td><Td>{titleCase(c.kitchenStatus)}</Td><Td>{c.reason ?? '—'}</Td><Td>{c.cancelledBy ?? '—'}</Td></tr>)}</tbody></Table>)}</Card></>);
}

function Stock({ range, csvBtn }) {
  const { data, error, loading, reload } = useAsync(() => api.get(`/reports/stock?${qs(range)}`), [range.from, range.to]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const q = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  return (
    <div className="space-y-4"><Bar2>{csvBtn}</Bar2>
      <Card className="overflow-hidden"><h3 className="px-4 pt-3 text-sm font-semibold">Current stock</h3><Table><thead><tr><Th>Ingredient</Th><Th right>In stock</Th><Th right>Minimum</Th><Th>Status</Th></tr></thead><tbody>
        {data.stock.map((i) => <tr key={i.name}><Td className="font-medium">{i.name}</Td><Td right>{q(i.stockQty)} {i.unit}</Td><Td right>{q(i.minStockQty)} {i.unit}</Td><Td>{i.low ? <Badge tone="amber">Low stock</Badge> : <Badge tone="green">OK</Badge>}</Td></tr>)}</tbody></Table></Card>
      <Card className="overflow-hidden"><h3 className="px-4 pt-3 text-sm font-semibold">Stock movements in period</h3>
        {!data.movements.length ? <Empty title="No stock movements in this period" /> : <div className="max-h-96 overflow-y-auto"><Table><thead><tr><Th>Time</Th><Th>Ingredient</Th><Th>Type</Th><Th right>Change</Th><Th>Reason</Th><Th>By</Th></tr></thead><tbody>
          {data.movements.map((m, i) => <tr key={i}><Td>{fmtDateTime(m.createdAt)}</Td><Td>{m.ingredient}</Td><Td>{titleCase(m.type)}</Td><Td right><span className={m.quantity < 0 ? 'text-rose' : 'text-sage-d'}>{m.quantity > 0 ? '+' : ''}{q(m.quantity)} {m.unit}</span></Td><Td>{m.reason ?? '—'}</Td><Td>{m.by ?? 'System'}</Td></tr>)}</tbody></Table></div>}</Card>
    </div>
  );
}
