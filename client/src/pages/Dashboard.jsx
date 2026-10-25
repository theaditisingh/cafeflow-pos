import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp, Receipt, IndianRupee, Percent, Utensils, ShoppingBag, Bike, AlertTriangle } from 'lucide-react';
import { api } from '../api.js';
import { Card, Spinner, ErrorBox, Empty, StatusBadge, DemoTag, PageHeader, Table, Th, Td, useAsync, usePoll, inr, fmtTime, titleCase } from '../ui.jsx';

const Kpi = ({ icon: Icon, label, value, sub }) => (
  <Card className="p-4 transition-shadow duration-200 hover:shadow-md">
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-terra-l text-terra"><Icon size={16} /></span>
      <span className="text-xs font-semibold text-ink-3">{label}</span>
    </div>
    <div className="mt-2 text-2xl font-bold tnum tracking-tight">{value}</div>{sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
  </Card>
);

export default function Dashboard() {
  const { data: d, error, loading, reload, refresh } = useAsync(() => api.get('/reports/dashboard'), []);
  usePoll(refresh, 15000);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const t = d.today;
  const trend = d.trend.map((x) => ({ day: new Date(`${x.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }), sales: x.totalCollectedPaise / 100, orders: x.orders }));
  const payTotal = d.payments.reduce((s, p) => s + p.amountPaise, 0);
  const topMax = Math.max(1, ...d.topItems.map((i) => i.quantity));
  return (
    <div className="mx-auto max-w-7xl p-4">
      <PageHeader title="Today at the cafe" subtitle="Live figures from paid orders. Updates every few seconds." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={IndianRupee} label="Gross sales" value={inr(t.grossSalesPaise)} sub="Before discounts, excluding tax" />
        <Kpi icon={TrendingUp} label="Net sales" value={inr(t.netSalesPaise)} sub={`After ${inr(t.discountPaise)} discounts · tax ${inr(t.taxPaise)} extra`} />
        <Kpi icon={Receipt} label="Total orders" value={d.totalOrdersToday} sub={`${t.orders} paid · excludes cancelled`} />
        <Kpi icon={Percent} label="Average order value" value={inr(t.avgOrderValuePaise)} sub={t.refundsPaise ? `${inr(t.refundsPaise)} refunded/voided today` : 'Per paid order, incl. tax'} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {[['Dine-in', 'DINE_IN', Utensils], ['Takeaway', 'TAKEAWAY', ShoppingBag], ['Delivery', 'DELIVERY', Bike]].map(([l, k, Icon]) => (
          <Card key={k} className="flex items-center gap-3 p-3.5 transition-shadow duration-200 hover:shadow-md"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-terra-l text-terra-d"><Icon size={18} /></span><div><div className="text-xl font-bold tnum">{d.typeCounts[k]}</div><div className="text-xs text-ink-3">{l} orders</div></div></Card>
        ))}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2"><h2 className="mb-3 font-bold">Sales — last 7 days</h2>
          <div className="h-60"><ResponsiveContainer width="100%" height="100%"><BarChart data={trend} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e4dac8" /><XAxis dataKey="day" tick={{ fontSize: 12, fill: '#8a847a' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: '#8a847a' }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
            <Tooltip cursor={{ fill: '#f3ece0' }} formatter={(v, n) => (n === 'sales' ? [`₹${Number(v).toLocaleString('en-IN')}`, 'Sales'] : [v, 'Orders'])} contentStyle={{ borderRadius: 8, border: '1px solid #e4dac8' }} />
            <Bar dataKey="sales" fill="#c0603c" radius={[4, 4, 0, 0]} maxBarSize={44} /></BarChart></ResponsiveContainer></div></Card>
        <Card className="p-4"><h2 className="mb-3 font-bold">Payment methods today</h2>
          {!d.payments.length ? <Empty title="No payments yet today" /> : <div className="space-y-3">{d.payments.map((p) => (
            <div key={p.method}><div className="mb-1 flex justify-between text-sm"><span>{titleCase(p.method)} <span className="text-ink-3">· {p.count}</span></span><span className="font-medium tnum">{inr(p.amountPaise)}</span></div>
              <div className="h-2 rounded-full bg-cream-2"><div className="h-2 rounded-full bg-sage" style={{ width: `${(p.amountPaise / payTotal) * 100}%` }} /></div></div>))}</div>}
        </Card>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Card className="p-4"><h2 className="mb-3 font-bold">Best sellers <span className="text-xs font-normal text-ink-3">· last 7 days</span></h2>
          {!d.topItems.length ? <Empty title="No sales yet" /> : <ol className="space-y-2.5">{d.topItems.map((i, n) => (
            <li key={i.name}><div className="flex justify-between text-sm"><span><span className="mr-2 text-ink-3">{n + 1}.</span>{i.name}</span><span className="font-medium tnum">{i.quantity} sold</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-cream-2"><div className="h-1.5 rounded-full bg-terra" style={{ width: `${(i.quantity / topMax) * 100}%` }} /></div></li>))}</ol>}
        </Card>
        <Card className="p-4"><h2 className="mb-3 flex items-center gap-2 font-bold">Low-stock alerts{d.lowStock.length > 0 && <span className="rounded-full bg-rose-l px-2 text-xs font-semibold text-rose">{d.lowStock.length}</span>}</h2>
          {!d.lowStock.length ? <Empty title="All ingredients are above minimum" /> : <ul className="space-y-2">{d.lowStock.map((i) => (
            <li key={i.id} className="flex items-center justify-between rounded-lg bg-rose-l/60 px-3 py-2 text-sm"><span className="flex items-center gap-2"><AlertTriangle size={14} className="text-rose" />{i.name}</span><span className="tnum text-rose">{i.stockQty} / {i.minStockQty} {i.unit}</span></li>))}</ul>}
        </Card>
        <Card className="overflow-hidden lg:col-span-1"><div className="p-4 pb-2"><h2 className="font-bold">Recent orders</h2></div>
          <Table><thead><tr><Th>Order</Th><Th>Status</Th><Th right>Total</Th></tr></thead><tbody>{d.recentOrders.map((o) => (
            <tr key={o.id}><Td><div className="flex items-center gap-1.5 font-medium">{o.orderNumber.split('-').pop()} {o.isDemo && <DemoTag />}</div><div className="text-xs text-ink-3">{o.tableName ? `Table ${o.tableName}` : titleCase(o.type)} · {fmtTime(o.createdAt)}</div></Td>
              <Td><div className="flex flex-col items-start gap-1"><StatusBadge kind="payment" value={o.paymentStatus} />{o.status !== 'CANCELLED' && o.kitchenStatus !== 'NOT_SENT' && o.paymentStatus === 'UNPAID' && <StatusBadge kind="kitchen" value={o.kitchenStatus} />}{o.status === 'CANCELLED' && <StatusBadge kind="order" value="CANCELLED" />}</div></Td><Td right>{inr(o.totalPaise)}</Td></tr>))}</tbody></Table>
        </Card>
      </div>
    </div>
  );
}
