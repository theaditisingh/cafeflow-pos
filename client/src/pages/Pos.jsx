import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Plus, Minus, Trash2, ShoppingBag, Coffee, CupSoda, Sandwich, Pizza, Cake, UtensilsCrossed, Beef, Soup, X, Send, Save, Wallet, Smartphone, CreditCard, UserRound, StickyNote } from 'lucide-react';
import { computeTotals } from '@billing';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ReceiptModal } from '../Receipt.jsx';
import { Button, Input, Select, Field, Modal, Spinner, ErrorBox, Empty, VegDot, StatusBadge, cx, inr, useAsync, useUi, uuid, titleCase } from '../ui.jsx';

const catIcon = (name = '') => {
  const n = name.toLowerCase();
  if (n.includes('coffee')) return Coffee; if (n.includes('tea')) return Soup; if (n.includes('cold')) return CupSoda; if (n.includes('snack')) return Sandwich;
  if (n.includes('pizza')) return Pizza; if (n.includes('burger')) return Beef; if (n.includes('dessert')) return Cake; return UtensilsCrossed;
};
const TILE = ['bg-terra-l text-terra-d', 'bg-sage-l text-sage-d', 'bg-amber-l text-amber-d', 'bg-sky-l text-sky'];
const lineKey = (l) => [l.menuItemId, l.variant?.id ?? '', l.addons.map((a) => a.id).sort().join('.'), l.notes ?? ''].join('|');
const unitOf = (l) => l.basePrice + (l.variant?.delta ?? 0) + l.addons.reduce((s, a) => s + a.price, 0);

export default function Pos() {
  const { settings, user } = useAuth();
  const { toast, confirm } = useUi();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const menu = useAsync(async () => {
    const [categories, items] = await Promise.all([api.get('/menu/categories'), api.get('/menu/items')]);
    return { categories, items };
  }, []);
  const tablesQ = useAsync(() => api.get('/tables'), []);

  const [catId, setCatId] = useState('all');
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [type, setType] = useState('DINE_IN');
  const [tableId, setTableId] = useState('');
  const [phone, setPhone] = useState('');
  const [custName, setCustName] = useState('');
  const [customer, setCustomer] = useState(null);
  const [discType, setDiscType] = useState('PERCENT');
  const [discInput, setDiscInput] = useState('');
  const [notes, setNotes] = useState('');
  const [order, setOrder] = useState(null); // server copy of the saved order
  const [busy, setBusy] = useState('');
  const [custom, setCustom] = useState(null); // item being customised
  const [payFor, setPayFor] = useState(null);
  const [receiptFor, setReceiptFor] = useState(null);
  const [showCart, setShowCart] = useState(false);
  const [noteIdx, setNoteIdx] = useState(null);
  const loadedRef = useRef(null);

  const items = menu.data?.items ?? [];
  const locked = order && order.status !== 'OPEN'; // sent to kitchen: items can no longer change

  // Load context from the URL: ?order=ID resumes an order, ?table=ID starts a dine-in order
  useEffect(() => {
    if (!menu.data) return;
    const orderId = params.get('order'), tId = params.get('table');
    const sig = `${orderId}|${tId}`;
    if (loadedRef.current === sig) return;
    loadedRef.current = sig;
    if (orderId) {
      api.get(`/orders/${orderId}`).then((o) => {
        setOrder(o); setType(o.type); setTableId(o.tableId ? String(o.tableId) : ''); setNotes(o.notes ?? '');
        setPhone(o.customerPhone ?? ''); setCustName(o.customerName ?? ''); setCustomer(o.customerId ? { id: o.customerId, name: o.customerName } : null);
        if (o.discountType) { setDiscType(o.discountType); setDiscInput(String(o.discountType === 'PERCENT' ? o.discountValue / 100 : o.discountValue / 100)); }
        setCart(o.items.map((i) => {
          const m = items.find((x) => x.id === i.menuItemId);
          const v = m?.variants.find((x) => x.name === i.variantName);
          return {
            menuItemId: i.menuItemId, name: i.name, isVeg: i.isVeg, taxRateBp: i.taxRateBp, quantity: i.quantity, notes: i.notes ?? '',
            basePrice: i.unitPricePaise - (v?.priceDeltaPaise ?? 0) - i.addons.reduce((s, a) => s + a.pricePaise, 0),
            variant: v ? { id: v.id, name: v.name, delta: v.priceDeltaPaise } : null,
            addons: i.addons.map((a) => ({ id: m?.addons.find((x) => x.name === a.name)?.id, name: a.name, price: a.pricePaise })),
          };
        }));
      }).catch((e) => toast(e.message, 'error'));
    } else if (tId) { setType('DINE_IN'); setTableId(tId); }
  }, [menu.data, params]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = cart.map((l) => ({ unitPricePaise: unitOf(l), quantity: l.quantity, taxRateBp: l.taxRateBp }));
  const discVal = Math.max(0, Math.round(parseFloat(discInput || '0') * 100)) || 0;
  const totals = useMemo(() => computeTotals(lines, { discountType: discVal > 0 ? discType : null, discountValue: discVal, taxInclusive: !!settings?.taxInclusive }), [cart, discType, discVal, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = cart.reduce((s, l) => s + l.quantity, 0);

  const shown = items.filter((i) => (catId === 'all' || i.categoryId === catId) && (!q || i.name.toLowerCase().includes(q.toLowerCase())));
  const catName = (id) => menu.data.categories.find((c) => c.id === id)?.name;

  const addLine = (line) => setCart((c) => {
    const k = lineKey(line);
    const i = c.findIndex((x) => lineKey(x) === k);
    if (i >= 0) return c.map((x, j) => (j === i ? { ...x, quantity: Math.min(99, x.quantity + line.quantity) } : x));
    return [...c, line];
  });
  const tapItem = (m) => {
    if (locked) return toast('This order is already in the kitchen. Items cannot be changed.', 'error');
    if (!m.available) return;
    const base = { menuItemId: m.id, name: m.name, isVeg: m.isVeg, basePrice: m.pricePaise, taxRateBp: m.taxRateBp, quantity: 1, notes: '', variant: null, addons: [] };
    if (m.variants.length || m.addons.length) setCustom({ item: m, line: { ...base, variant: m.variants[0] ? { id: m.variants[0].id, name: m.variants[0].name, delta: m.variants[0].priceDeltaPaise } : null } });
    else addLine(base);
  };
  const setQty = (idx, d) => setCart((c) => c.flatMap((l, i) => (i !== idx ? [l] : l.quantity + d <= 0 ? [] : [{ ...l, quantity: Math.min(99, l.quantity + d) }])));

  const lookupCustomer = async () => {
    const p = phone.trim();
    if (p.length < 7) return setCustomer(null);
    try {
      const found = (await api.get(`/customers?q=${encodeURIComponent(p)}`)).find((c) => c.phone === p);
      setCustomer(found ?? null);
      if (found) setCustName(found.name);
    } catch { /* lookup is optional */ }
  };

  const reset = () => {
    setCart([]); setOrder(null); setTableId(''); setPhone(''); setCustName(''); setCustomer(null); setDiscInput(''); setNotes(''); setShowCart(false);
    loadedRef.current = null; setParams({}, { replace: true }); tablesQ.refresh();
  };

  const payload = () => ({
    type, tableId: type === 'DINE_IN' ? Number(tableId) : null, notes: notes || undefined,
    customerPhone: phone.trim() || undefined, customerName: custName.trim() || undefined, customerId: customer?.id,
    discount: discVal > 0 ? { type: discType, value: discVal } : null,
    items: cart.map((l) => ({ menuItemId: l.menuItemId, variantId: l.variant?.id ?? null, addonIds: l.addons.map((a) => a.id), quantity: l.quantity, notes: l.notes || undefined })),
  });
  const validate = () => {
    if (!cart.length) { toast('Add at least one item', 'error'); return false; }
    if (type === 'DINE_IN' && !tableId && !order) { toast('Select a table for dine-in', 'error'); return false; }
    return true;
  };
  // Saves the cart on the server (create or update) and returns the server's priced order.
  const ensureOrder = async () => {
    if (order && order.status !== 'OPEN') return order;
    const saved = order ? await api.put(`/orders/${order.id}`, payload()) : await api.post('/orders', payload());
    setOrder(saved); return saved;
  };
  const run = (name, fn) => async () => {
    if (busy || !validate()) return;
    setBusy(name);
    try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); tablesQ.refresh(); }
  };
  const save = run('save', async () => { const o = await ensureOrder(); toast(`Order ${o.orderNumber} saved`); reset(); });
  const sendKot = run('kot', async () => {
    let o = await ensureOrder();
    if (o.kitchenStatus === 'NOT_SENT') o = await api.post(`/orders/${o.id}/send-kitchen`);
    setOrder(o); toast(`KOT ${o.kotNumber?.split('-').pop()} sent to kitchen for ${o.orderNumber}`);
  });
  const pay = run('pay', async () => { const o = await ensureOrder(); setPayFor(o); });
  const cancelOrder = async () => {
    const reason = await confirm({ title: 'Cancel this order?', message: `${order.orderNumber} will be cancelled${order.kitchenStatus !== 'NOT_SENT' ? ' and the kitchen ticket removed' : ''}.`, confirmLabel: 'Cancel order', danger: true, reason: { label: 'Reason for cancelling' } });
    if (!reason) return;
    try { await api.post(`/orders/${order.id}/cancel`, { reason }); toast('Order cancelled'); reset(); } catch (e) { toast(e.message, 'error'); }
  };

  if (menu.loading) return <Spinner label="Loading menu…" />;
  if (menu.error) return <ErrorBox error={menu.error} onRetry={menu.reload} />;
  const freeTables = (tablesQ.data ?? []).filter((t) => t.status !== 'OCCUPIED' || String(t.id) === tableId);
  const money = order && order.status !== 'OPEN' ? { sub: order.subtotalPaise, disc: order.discountPaise, tax: order.taxPaise, total: order.totalPaise } : { sub: totals.subtotalPaise, disc: totals.discountPaise, tax: totals.taxPaise, total: totals.totalPaise };

  return (
    <div className="flex h-full min-h-0">
      {/* ---------- Menu ---------- */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-2.5 border-b border-line bg-white p-3">
          <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search menu items…" className="pl-9" aria-label="Search menu" /></div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Menu categories">
            {[{ id: 'all', name: 'All' }, ...menu.data.categories].map((c) => (
              <button key={c.id} role="tab" aria-selected={catId === c.id} onClick={() => setCatId(c.id)} className={cx('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-150', catId === c.id ? 'bg-terra text-white shadow-sm shadow-terra/30' : 'bg-cream-2 text-ink-2 hover:bg-line/70 hover:text-ink')}>{c.name}</button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24 lg:pb-3">
          {!shown.length ? <Empty title="No menu items found" hint={q ? 'Try a different search.' : 'Add items under Menu.'} /> : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {shown.map((m) => {
                const Icon = catIcon(catName(m.categoryId));
                return (
                  <button key={m.id} onClick={() => tapItem(m)} disabled={!m.available} aria-label={`${m.name} ${inr(m.pricePaise, { compact: true })}`}
                    className={cx('group relative flex flex-col overflow-hidden rounded-xl border border-line bg-white text-left shadow-sm shadow-black/[0.02] transition-all duration-200', m.available ? 'hover:-translate-y-0.5 hover:border-terra/60 hover:shadow-md active:scale-[0.98]' : 'opacity-60')}>
                    {m.imageUrl ? <img src={m.imageUrl} alt="" className="h-20 w-full object-cover transition-transform duration-300 group-hover:scale-105" /> : <div className={cx('flex h-20 items-center justify-center transition-colors', TILE[m.categoryId % TILE.length])}><Icon size={30} strokeWidth={1.6} /></div>}
                    <div className="flex flex-1 flex-col gap-1 p-2.5">
                      <div className="flex items-start gap-1.5"><VegDot veg={m.isVeg} /><span className="line-clamp-2 text-sm font-semibold leading-tight text-ink transition-colors group-hover:text-terra">{m.name}</span></div>
                      <div className="mt-auto flex items-center justify-between pt-1"><span className="font-bold text-ink tnum">{inr(m.pricePaise, { compact: true })}</span>
                        {(m.variants.length > 0 || m.addons.length > 0) && <span className="rounded bg-cream-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-3">Customise</span>}</div>
                    </div>
                    {!m.available && <span className="absolute right-2 top-2 rounded-md bg-ink/80 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-xs">Out of stock</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* mobile cart button */}
      {!showCart && <button onClick={() => setShowCart(true)} className="fixed bottom-4 left-4 right-4 z-30 flex items-center justify-between rounded-xl bg-terra px-4 py-3.5 text-white shadow-lg lg:hidden">
        <span className="flex items-center gap-2"><ShoppingBag size={18} />{count} item{count === 1 ? '' : 's'}</span><span className="font-semibold tnum">{inr(money.total)}</span></button>}

      {/* ---------- Cart ---------- */}
      <aside className={cx('w-full flex-col border-l border-line bg-white lg:flex lg:w-[390px] lg:shrink-0', showCart ? 'fixed inset-0 z-40 flex' : 'hidden')} aria-label="Current order">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div><div className="font-semibold">{order ? order.orderNumber : 'New order'}</div>
            {order && <div className="mt-0.5 flex gap-1.5"><StatusBadge kind="kitchen" value={order.kitchenStatus} /><StatusBadge kind="payment" value={order.paymentStatus} /></div>}</div>
          <div className="flex items-center gap-1">
            {(cart.length > 0 || order) && !locked && <Button size="sm" variant="ghost" onClick={() => (order ? cancelOrder() : reset())}>{order ? 'Cancel order' : 'Clear'}</Button>}
            {locked && <Button size="sm" variant="ghost" onClick={cancelOrder}>Cancel order</Button>}
            <button onClick={() => setShowCart(false)} className="rounded p-1.5 hover:bg-cream-2 lg:hidden" aria-label="Close cart"><X size={18} /></button>
          </div>
        </div>

        <div className="space-y-2 border-b border-line p-3">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-cream-2 p-1" role="radiogroup" aria-label="Order type">
            {[['DINE_IN', 'Dine-in'], ['TAKEAWAY', 'Takeaway'], ['DELIVERY', 'Delivery']].map(([v, l]) => (
              <button key={v} role="radio" aria-checked={type === v} disabled={!!order} onClick={() => setType(v)} className={cx('rounded-lg py-1.5 text-sm font-semibold transition-all duration-150', type === v ? 'bg-white text-ink shadow-sm' : 'text-ink-2 hover:text-ink', order && 'cursor-not-allowed opacity-70')}>{l}</button>
            ))}
          </div>
          {type === 'DINE_IN' && (
            <Select value={tableId} onChange={(e) => setTableId(e.target.value)} disabled={!!order} aria-label="Table">
              <option value="">Select table…</option>
              {freeTables.map((t) => <option key={t.id} value={t.id}>{t.name} · {titleCase(t.area)} · seats {t.capacity}{t.status !== 'AVAILABLE' && String(t.id) !== tableId ? ` (${titleCase(t.status)})` : ''}</option>)}
            </Select>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="relative"><UserRound size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" /><Input className="pl-8" placeholder="Customer phone" inputMode="tel" value={phone} disabled={locked} onChange={(e) => { setPhone(e.target.value); setCustomer(null); }} onBlur={lookupCustomer} aria-label="Customer phone" /></div>
            <Input placeholder="Customer name" value={custName} disabled={locked} onChange={(e) => setCustName(e.target.value)} aria-label="Customer name" />
          </div>
          {customer && <div className="text-xs font-medium text-sage-d">Existing customer: {customer.name} · {customer.loyaltyPoints ?? 0} loyalty points</div>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!cart.length ? <Empty icon={ShoppingBag} title="Cart is empty" hint="Tap menu items to add them." /> : (
            <ul className="divide-y divide-line/60">
              {cart.map((l, i) => (
                <li key={lineKey(l)} className="px-4 py-3 transition-colors hover:bg-cream/40">
                  <div className="flex items-start gap-2"><VegDot veg={l.isVeg} />
                    <div className="min-w-0 flex-1"><div className="text-sm font-semibold leading-tight text-ink">{l.name}{l.variant ? <span className="font-normal text-ink-3"> · {l.variant.name}</span> : ''}</div>
                      {l.addons.length > 0 && <div className="mt-0.5 text-xs text-ink-3">+ {l.addons.map((a) => a.name).join(', ')}</div>}
                      {l.notes && <div className="mt-0.5 flex items-center gap-1 text-xs italic text-amber-d"><StickyNote size={11} />{l.notes}</div>}</div>
                    <div className="text-sm font-bold text-ink tnum">{inr(unitOf(l) * l.quantity)}</div></div>
                  {!locked ? (
                    <div className="mt-2 flex items-center justify-between pl-6">
                      <div className="flex items-center rounded-lg border border-line bg-white shadow-2xs">
                        <button onClick={() => setQty(i, -1)} className="p-1.5 transition-colors hover:bg-cream-2 text-ink-2" aria-label={`Decrease ${l.name}`}><Minus size={13} /></button>
                        <span className="w-8 text-center text-sm font-bold text-ink tnum" aria-label="Quantity">{l.quantity}</span>
                        <button onClick={() => setQty(i, 1)} className="p-1.5 transition-colors hover:bg-cream-2 text-ink-2" aria-label={`Increase ${l.name}`}><Plus size={13} /></button></div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setNoteIdx(i)} className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-cream-2 hover:text-ink" aria-label={`Note for ${l.name}`}><StickyNote size={15} /></button>
                        <button onClick={() => setCart((c) => c.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-rose-l hover:text-rose" aria-label={`Remove ${l.name}`}><Trash2 size={15} /></button></div>
                    </div>
                  ) : <div className="pl-6 text-xs text-ink-3">Qty {l.quantity} × {inr(unitOf(l))}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t border-line bg-cream/70 p-3.5">
          {!locked && (
            <div className="flex gap-2">
              <Select value={discType} onChange={(e) => setDiscType(e.target.value)} className="!w-36" aria-label="Discount type"><option value="PERCENT">Discount %</option><option value="FLAT">Discount ₹</option></Select>
              <Input type="number" min="0" step="any" inputMode="decimal" placeholder="0" value={discInput} onChange={(e) => setDiscInput(e.target.value)} aria-label="Discount value" />
              <Input placeholder="Order note" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} aria-label="Order note" />
            </div>
          )}
          <dl className="space-y-1 text-sm tnum">
            <div className="flex justify-between text-ink-2"><dt>Subtotal</dt><dd className="font-medium">{inr(money.sub)}</dd></div>
            {money.disc > 0 && <div className="flex justify-between font-medium text-sage-d"><dt>Discount</dt><dd>−{inr(money.disc)}</dd></div>}
            <div className="flex justify-between text-ink-2"><dt>Tax{settings?.taxInclusive ? ' (included)' : ''}</dt><dd className="font-medium">{inr(money.tax)}</dd></div>
            <div className="flex justify-between border-t border-line/80 pt-2 text-lg font-bold text-ink"><dt>Payable</dt><dd className="text-terra-d">{inr(money.total)}</dd></div>
          </dl>
          {locked && <p className="text-xs text-ink-3">Sent to kitchen. Items are locked. Take payment or cancel (manager approval needed once cooking is under way).</p>}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {!locked && <Button onClick={save} loading={busy === 'save'} disabled={!cart.length}><Save size={15} />Save</Button>}
            {!locked ? <Button onClick={sendKot} loading={busy === 'kot'} disabled={!cart.length}><Send size={15} />Send KOT</Button> : <Button disabled><Send size={15} />KOT sent</Button>}
            <Button variant="primary" size="lg" className="col-span-2 shadow-sm font-semibold" onClick={pay} loading={busy === 'pay'} disabled={!cart.length}>Pay {inr(money.total)}</Button>
          </div>
        </div>
      </aside>

      {noteIdx !== null && cart[noteIdx] && <NoteModal line={cart[noteIdx]} onClose={() => setNoteIdx(null)} onSave={(n) => { setCart((c) => c.map((x, j) => (j === noteIdx ? { ...x, notes: n } : x))); setNoteIdx(null); }} />}
      {custom && <CustomizeModal {...custom} onClose={() => setCustom(null)} onAdd={(l) => { addLine(l); setCustom(null); }} />}
      {payFor && <PayModal order={payFor} onClose={() => setPayFor(null)} onPaid={(o) => { setPayFor(null); setReceiptFor(o); toast(`Payment recorded for ${o.orderNumber}`); }} />}
      {receiptFor && <ReceiptModal orderId={receiptFor.id} title={`Receipt ${receiptFor.receiptNumber ?? ''}`} onClose={() => { setReceiptFor(null); reset(); }} />}
    </div>
  );
}

function NoteModal({ line, onClose, onSave }) {
  const [n, setN] = useState(line.notes ?? '');
  return (
    <Modal title={`Note · ${line.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave(n.trim())}>Save note</Button></>}>
      <Field label="Note for the kitchen" hint="Shown on the kitchen ticket and the receipt."><Input autoFocus value={n} maxLength={200} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSave(n.trim())} placeholder="e.g. less sugar, no onion" /></Field>
    </Modal>
  );
}

function CustomizeModal({ item, line, onClose, onAdd }) {
  const [l, setL] = useState(line);
  const toggle = (a) => setL((x) => ({ ...x, addons: x.addons.some((y) => y.id === a.id) ? x.addons.filter((y) => y.id !== a.id) : [...x.addons, { id: a.id, name: a.name, price: a.pricePaise }] }));
  return (
    <Modal title={item.name} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onAdd(l)}>Add · {inr(unitOf(l) * l.quantity)}</Button></>}>
      <div className="space-y-4">
        {item.variants.length > 0 && <fieldset><legend className="mb-1.5 text-xs font-medium text-ink-2">Size / variant</legend>
          <div className="flex flex-wrap gap-2">{item.variants.map((v) => (
            <button key={v.id} type="button" onClick={() => setL((x) => ({ ...x, variant: { id: v.id, name: v.name, delta: v.priceDeltaPaise } }))} className={cx('rounded-lg border px-3 py-2 text-sm', l.variant?.id === v.id ? 'border-terra bg-terra-l text-terra-d' : 'border-line bg-white')}>
              {v.name}{v.priceDeltaPaise !== 0 && <span className="ml-1 text-xs text-ink-3">{v.priceDeltaPaise > 0 ? '+' : '−'}{inr(Math.abs(v.priceDeltaPaise), { compact: true })}</span>}</button>))}</div></fieldset>}
        {item.addons.length > 0 && <fieldset><legend className="mb-1.5 text-xs font-medium text-ink-2">Extras</legend>
          <div className="space-y-1.5">{item.addons.map((a) => (
            <label key={a.id} className="flex cursor-pointer items-center justify-between rounded-lg border border-line bg-white px-3 py-2 text-sm"><span className="flex items-center gap-2"><input type="checkbox" checked={l.addons.some((y) => y.id === a.id)} onChange={() => toggle(a)} className="accent-[var(--color-terra)]" />{a.name}</span><span className="text-ink-3 tnum">+{inr(a.pricePaise, { compact: true })}</span></label>))}</div></fieldset>}
        <Field label="Note for the kitchen"><Input value={l.notes} maxLength={200} onChange={(e) => setL({ ...l, notes: e.target.value })} placeholder="e.g. less sugar, extra hot" /></Field>
        <div className="flex items-center gap-3"><span className="text-sm text-ink-2">Quantity</span>
          <div className="flex items-center rounded-lg border border-line bg-white"><button onClick={() => setL({ ...l, quantity: Math.max(1, l.quantity - 1) })} className="p-2" aria-label="Decrease"><Minus size={15} /></button><span className="w-9 text-center font-medium tnum">{l.quantity}</span><button onClick={() => setL({ ...l, quantity: Math.min(99, l.quantity + 1) })} className="p-2" aria-label="Increase"><Plus size={15} /></button></div></div>
      </div>
    </Modal>
  );
}

function PayModal({ order, onClose, onPaid }) {
  const { toast } = useUi();
  const [method, setMethod] = useState('CASH');
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(uuid()); // one key per modal: repeated clicks / retries can never record two payments
  const total = order.totalPaise;
  const recPaise = received === '' ? total : Math.round(parseFloat(received) * 100);
  const change = method === 'CASH' ? recPaise - total : 0;
  const quick = [...new Set([total, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000, Math.ceil(total / 200000) * 200000])];
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await api.post(`/orders/${order.id}/payments`, { method, cashReceivedPaise: method === 'CASH' ? recPaise : undefined, reference: reference.trim() || undefined, idempotencyKey: key.current });
      onPaid(r.order);
    } catch (e) { setError(e.message); toast(e.message, 'error'); setBusy(false); }
  };
  const M = [['CASH', 'Cash', Wallet], ['UPI', 'UPI', Smartphone], ['CARD', 'Card', CreditCard]];
  return (
    <Modal title={`Payment · ${order.orderNumber}`} onClose={busy ? undefined : onClose} footer={<><Button onClick={onClose} disabled={busy}>Back</Button><Button variant="green" size="lg" onClick={submit} loading={busy} disabled={method === 'CASH' && change < 0}>Record payment {inr(total)}</Button></>}>
      <div className="mb-4 rounded-xl border border-line/70 bg-gradient-to-b from-white to-cream-2/40 p-4 text-center shadow-xs">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Amount payable</div>
        <div className="mt-1 text-3xl font-bold tracking-tight text-ink tnum">{inr(total)}</div>
        <div className="mt-1.5 text-xs text-ink-3 tnum">Subtotal {inr(order.subtotalPaise)}{order.discountPaise > 0 && ` · Discount −${inr(order.discountPaise)}`} · Tax {inr(order.taxPaise)}</div>
      </div>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment method">
        {M.map(([v, l, Icon]) => (
          <button key={v} role="radio" aria-checked={method === v} onClick={() => setMethod(v)}
            className={cx('flex flex-col items-center gap-1.5 rounded-xl border-2 py-3 text-sm font-semibold transition-all duration-150', method === v ? 'border-terra bg-terra-l/60 text-terra-d shadow-xs' : 'border-line bg-white text-ink-2 hover:bg-cream-2 hover:text-ink')}>
            <Icon size={20} /><span>{l}</span>
          </button>
        ))}
      </div>
      {method === 'CASH' ? (
        <div className="mt-4 space-y-2.5">
          <Field label="Cash received (₹)"><Input type="number" min="0" step="any" inputMode="decimal" autoFocus value={received} placeholder={(total / 100).toFixed(2)} onChange={(e) => setReceived(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-1.5">{quick.map((p) => <button key={p} onClick={() => setReceived(String(p / 100))} className="rounded-full border border-line bg-white px-3 py-1 text-xs font-medium tnum transition-colors hover:border-terra/40 hover:bg-cream-2">{p === total ? 'Exact' : inr(p, { compact: true })}</button>)}</div>
          <div className={cx('flex justify-between rounded-lg px-3 py-2 text-sm font-semibold tnum', change < 0 ? 'bg-rose-l text-rose' : 'bg-sage-l text-sage-d')}><span>{change < 0 ? 'Short by' : 'Change to return'}</span><span>{inr(Math.abs(change))}</span></div>
        </div>
      ) : (
        <div className="mt-4 space-y-2"><Field label={method === 'UPI' ? 'UPI reference (optional)' : 'Card slip / approval code (optional)'}><Input value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} placeholder="Reference from your terminal or UPI app" /></Field>
          <p className="rounded-lg bg-amber-l px-3 py-2 text-xs text-amber-d">Demo payment record: CafeFlow does not process {method === 'UPI' ? 'UPI' : 'card'} transactions. Confirm only after the customer has paid through your own {method === 'UPI' ? 'UPI app / QR' : 'card machine'}.</p></div>
      )}
      {error && <div role="alert" className="mt-3 rounded-lg bg-rose-l px-3 py-2 text-sm text-rose">{error}</div>}
    </Modal>
  );
}
