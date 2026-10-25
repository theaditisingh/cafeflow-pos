import { useState, useEffect } from 'react';
import { ChefHat, Clock, StickyNote, ArrowRight, Undo2, List, LayoutGrid } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Button, Spinner, ErrorBox, Empty, VegDot, StatusBadge, Table, Th, Td, cx, useAsync, usePoll, useUi, fmtDuration, fmtTime, titleCase } from '../ui.jsx';

const COLS = [['NEW', 'New', 'border-sky', 'bg-sky-l'], ['PREPARING', 'Preparing', 'border-amber-d', 'bg-amber-l'], ['READY', 'Ready', 'border-sage', 'bg-sage-l'], ['SERVED', 'Served', 'border-ink-3', 'bg-cream-2']];
const NEXT = { NEW: ['PREPARING', 'Start preparing'], PREPARING: ['READY', 'Mark ready'], READY: ['SERVED', 'Mark served'] };
const BACK = { PREPARING: 'NEW', READY: 'PREPARING' };

function useNow() { const [n, setN] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(t); }, []); return n; }

export default function Kitchen() {
  const { toast } = useUi();
  const { user } = useAuth();
  const [view, setView] = useState('board');
  const [station, setStation] = useState('');
  const [listFilter, setListFilter] = useState('active');
  const [busyId, setBusyId] = useState(null);
  const now = useNow();
  const { data, error, loading, reload, refresh } = useAsync(() => api.get(`/kitchen/tickets${station ? `?station=${station}` : ''}`), [station]);
  usePoll(refresh, 4000); // near-real-time sync with the billing counter

  const move = async (t, status) => {
    setBusyId(t.id);
    try { await api.patch(`/kitchen/orders/${t.id}/status`, { status }); await refresh(); } catch (e) { toast(e.message, 'error'); refresh(); } finally { setBusyId(null); }
  };
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  // Live ageing for tickets that are still in progress
  const age = (t) => (['NEW', 'PREPARING'].includes(t.kitchenStatus) ? Math.round((now - new Date(t.sentToKitchenAt)) / 1000) : t.waitSeconds);
  const listRows = data.filter((t) => (listFilter === 'active' ? t.kitchenStatus !== 'SERVED' : listFilter === 'completed' ? t.kitchenStatus === 'SERVED' : true));

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight"><ChefHat size={22} />Kitchen display</h1>
        <span className="text-xs text-ink-3">Auto-refreshes every 4 s</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select value={station} onChange={(e) => setStation(e.target.value)} aria-label="Station filter" className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm"><option value="">All stations</option><option value="BAR">Bar</option><option value="KITCHEN">Kitchen</option><option value="DESSERT">Dessert</option></select>
          <div className="flex rounded-lg border border-line bg-white p-0.5">
            <button onClick={() => setView('board')} className={cx('flex items-center gap-1 rounded-md px-2.5 py-1 text-sm', view === 'board' && 'bg-ink text-white')}><LayoutGrid size={14} />Board</button>
            <button onClick={() => setView('list')} className={cx('flex items-center gap-1 rounded-md px-2.5 py-1 text-sm', view === 'list' && 'bg-ink text-white')}><List size={14} />KOT list</button></div>
        </div>
      </div>

      {view === 'board' ? (
        <div className="grid min-h-0 flex-1 gap-3 overflow-x-auto md:grid-cols-4" style={{ gridAutoColumns: 'minmax(270px,1fr)' }}>
          {COLS.map(([key, label, border, bg]) => {
            const col = data.filter((t) => t.kitchenStatus === key);
            return (
              <section key={key} className="flex min-h-[200px] min-w-[270px] flex-col rounded-2xl border border-line/60 bg-cream-2/60 shadow-2xs" aria-label={`${label} tickets`}>
                <header className={cx('flex items-center justify-between rounded-t-2xl border-t-4 px-3.5 py-2.5', border, bg)}>
                  <h2 className="text-base font-bold tracking-tight text-ink">{label}</h2>
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold shadow-2xs tnum text-ink">{col.length}</span>
                </header>
                <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
                  {!col.length && <p className="py-8 text-center text-sm font-medium text-ink-3">No tickets</p>}
                  {col.map((t) => {
                    const a = age(t);
                    const late = ['NEW', 'PREPARING'].includes(t.kitchenStatus) && a > 600;
                    return (
                      <article key={t.id} className={cx('rounded-xl border-2 bg-white p-3.5 shadow-sm transition-all duration-150 hover:shadow-md', late ? 'border-rose' : 'border-line/70')}>
                        <div className="flex items-start justify-between gap-2"><div><div className="text-xl font-extrabold tracking-tight text-ink">#{t.kotNumber?.split('-').pop()}</div>
                          <div className="mt-0.5 text-sm font-semibold text-ink-2">{t.type === 'DINE_IN' ? `Table ${t.tableName}` : titleCase(t.type)}</div></div>
                          <div className="text-right"><div className={cx('flex items-center justify-end gap-1 text-base font-bold tnum', late ? 'text-rose' : 'text-ink')}><Clock size={14} />{fmtDuration(a)}</div><div className="text-xs text-ink-3">{fmtTime(t.sentToKitchenAt)}</div></div></div>
                        <ul className="mt-2.5 space-y-1.5 border-t border-dashed border-line pt-2.5">
                          {t.items.map((i) => (
                            <li key={i.id} className="text-[14px]"><div className="flex items-start gap-2"><span className="w-6 shrink-0 text-base font-bold text-terra tnum">{i.quantity}×</span><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 font-semibold text-ink"><VegDot veg={i.isVeg} />{i.name}{i.variantName && <span className="font-normal text-ink-3"> · {i.variantName}</span>}</div>
                              {i.addons?.length > 0 && <div className="text-xs text-ink-2">+ {i.addons.map((x) => x.name).join(', ')}</div>}
                              {i.notes && <div className="mt-0.5 flex items-center gap-1 rounded-md bg-amber-l px-1.5 py-0.5 text-xs font-medium text-amber-d"><StickyNote size={11} />{i.notes}</div>}</div></div></li>))}</ul>
                        {t.notes && <div className="mt-2 rounded-md bg-amber-l/80 px-2 py-1 text-xs font-semibold text-amber-d">Order note: {t.notes}</div>}
                        {t.prepSeconds != null && t.kitchenStatus !== 'NEW' && <div className="mt-2 text-xs font-medium text-ink-3">Prep time: {fmtDuration(t.kitchenStatus === 'PREPARING' ? Math.round((now - new Date(t.preparingAt)) / 1000) : t.prepSeconds)}</div>}
                        <div className="mt-3 flex gap-2">
                          {NEXT[t.kitchenStatus] && <Button variant={t.kitchenStatus === 'PREPARING' ? 'green' : 'primary'} size="lg" className="flex-1 font-semibold" loading={busyId === t.id} onClick={() => move(t, NEXT[t.kitchenStatus][0])}>{NEXT[t.kitchenStatus][1]}<ArrowRight size={16} /></Button>}
                          {BACK[t.kitchenStatus] && <Button size="lg" onClick={() => move(t, BACK[t.kitchenStatus])} disabled={busyId === t.id} aria-label="Move back"><Undo2 size={16} /></Button>}
                        </div>
                        {t.paymentStatus === 'PAID' && <div className="mt-2.5"><StatusBadge kind="payment" value="PAID" /></div>}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-white">
          <div className="flex gap-2 border-b border-line p-2.5">{[['active', 'Active'], ['completed', 'Completed'], ['all', 'All']].map(([k, l]) => <button key={k} onClick={() => setListFilter(k)} className={cx('rounded-full px-3 py-1 text-sm', listFilter === k ? 'bg-ink text-white' : 'bg-cream-2 text-ink-2')}>{l}</button>)}</div>
          {!listRows.length ? <Empty title="No tickets" hint="Completed tickets stay here for 4 hours." /> : (
            <Table><thead><tr><Th>KOT</Th><Th>Order</Th><Th>For</Th><Th>Items</Th><Th>Sent</Th><Th>Wait</Th><Th>Prep</Th><Th>Kitchen</Th><Th>Billing</Th></tr></thead><tbody>
              {listRows.map((t) => (
                <tr key={t.id}><Td className="font-semibold">#{t.kotNumber?.split('-').pop()}</Td><Td>{t.orderNumber.split('-').pop()}</Td><Td>{t.type === 'DINE_IN' ? `Table ${t.tableName}` : titleCase(t.type)}</Td>
                  <Td className="max-w-xs">{t.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}{t.notes && <div className="text-xs italic text-amber-d">{t.notes}</div>}</Td>
                  <Td>{fmtTime(t.sentToKitchenAt)}</Td><Td className="tnum">{fmtDuration(age(t))}</Td><Td className="tnum">{fmtDuration(t.prepSeconds)}</Td>
                  <Td><StatusBadge kind="kitchen" value={t.kitchenStatus} /></Td><Td><StatusBadge kind="payment" value={t.paymentStatus} /></Td></tr>))}</tbody></Table>)}
        </div>
      )}
      {user.role === 'KITCHEN' && <p className="mt-2 text-center text-xs text-ink-3">Signed in as kitchen staff. You can update ticket status only.</p>}
    </div>
  );
}
