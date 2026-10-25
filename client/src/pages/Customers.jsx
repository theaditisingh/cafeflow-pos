import { useState } from 'react';
import { Plus, Search, Pencil, Star } from 'lucide-react';
import { api } from '../api.js';
import { ReceiptModal } from '../Receipt.jsx';
import { Button, Card, Field, Input, Modal, Spinner, ErrorBox, Empty, StatusBadge, PageHeader, Table, Th, Td, useAsync, useUi, inr, fmtDate, fmtDateTime, titleCase } from '../ui.jsx';

export default function Customers() {
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const { data, error, loading, reload, refresh } = useAsync(() => api.get(`/customers?q=${encodeURIComponent(applied)}`), [applied]);
  const [edit, setEdit] = useState(null);
  const [openId, setOpenId] = useState(null);

  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Customers & loyalty" subtitle="Points are earned only after a payment is recorded, and are reversed if that payment is refunded or voided."
        actions={<Button variant="primary" onClick={() => setEdit({})}><Plus size={15} />Add customer</Button>} />
      <Card className="overflow-hidden shadow-sm">
        <form className="flex gap-2.5 border-b border-line bg-cream/30 p-3.5" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }}>
          <div className="relative max-w-sm flex-1"><Search size={15} className="absolute left-3 top-2.5 text-ink-3" /><Input className="pl-9" placeholder="Search by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Button type="submit">Search</Button>
          {applied && <Button type="button" variant="ghost" onClick={() => { setQ(''); setApplied(''); }}>Clear</Button>}
        </form>
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.length ? <Empty title="No customers found" hint={applied ? 'Try a different name or phone number.' : 'Customers are added here or from the billing screen.'} /> : (
          <Table><thead><tr><Th>Customer</Th><Th>Phone</Th><Th right>Paid orders</Th><Th right>Total spent</Th><Th right>Points</Th><Th right> </Th></tr></thead><tbody>
            {data.map((c) => (
              <tr key={c.id} className="cursor-pointer transition-colors duration-150 hover:bg-cream-2/60" onClick={() => setOpenId(c.id)}>
                <Td className="font-semibold text-ink">{c.name}</Td><Td className="text-ink-2">{c.phone ?? <span className="text-ink-3">—</span>}</Td><Td right className="font-medium tnum">{c.orderCount}</Td><Td right className="font-bold text-ink">{inr(c.totalSpentPaise)}</Td>
                <Td right><span className="inline-flex items-center gap-1 rounded-full bg-amber-l/80 px-2.5 py-0.5 text-xs font-bold text-amber-d"><Star size={12} className="fill-amber-d" />{c.loyaltyPoints}</span></Td>
                <Td right><Button size="sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={(e) => { e.stopPropagation(); setEdit(c); }}><Pencil size={15} /></Button></Td>
              </tr>))}
          </tbody></Table>)}
      </Card>
      {edit && <CustomerForm customer={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
      {openId && <CustomerDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function CustomerForm({ customer, onClose, onSaved }) {
  const { toast } = useUi();
  const [name, setName] = useState(customer.name ?? '');
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { customer.id ? await api.put(`/customers/${customer.id}`, { name, phone }) : await api.post('/customers', { name, phone }); toast('Customer saved'); onSaved(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={customer.id ? 'Edit customer' : 'New customer'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><Input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone (optional)" hint="Used to find the customer quickly at billing."><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        {err && <div className="rounded-lg bg-rose-l px-3 py-2 text-sm text-rose">{err}</div>}
      </div>
    </Modal>
  );
}

function CustomerDetail({ id, onClose }) {
  const { data: c, error, loading, reload } = useAsync(() => api.get(`/customers/${id}`), [id]);
  const [receiptId, setReceiptId] = useState(null);
  return (
    <>
      <Modal title={c?.name ?? 'Customer'} size="lg" onClose={onClose}>
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-3 gap-3">
              {[['Paid orders', c.orderCount], ['Total spent', inr(c.totalSpentPaise)], ['Loyalty points', c.loyaltyPoints]].map(([k, v]) => <Card key={k} className="p-3"><div className="text-xs text-ink-3">{k}</div><div className="text-lg font-semibold tnum">{v}</div></Card>)}
            </div>
            <div className="text-ink-3">{c.phone ?? 'No phone on file'} · customer since {fmtDate(c.createdAt)}</div>
            <div><h3 className="mb-1.5 font-semibold">Orders</h3>
              {!c.orders.length ? <p className="text-ink-3">No orders yet.</p> : <Card className="overflow-hidden"><Table><thead><tr><Th>Order</Th><Th>Date</Th><Th>Payment</Th><Th right>Total</Th></tr></thead><tbody>
                {c.orders.map((o) => <tr key={o.id} className={o.status !== 'CANCELLED' ? 'cursor-pointer hover:bg-cream-2/50' : ''} onClick={() => o.status !== 'CANCELLED' && setReceiptId(o)}>
                  <Td>{o.orderNumber}</Td><Td>{fmtDateTime(o.createdAt)}</Td><Td>{o.status === 'CANCELLED' ? <StatusBadge kind="order" value="CANCELLED" /> : <StatusBadge kind="payment" value={o.paymentStatus} />}</Td><Td right>{inr(o.totalPaise)}</Td></tr>)}
              </tbody></Table></Card>}</div>
            <div><h3 className="mb-1.5 font-semibold">Loyalty history</h3>
              {!c.loyalty.length ? <p className="text-ink-3">No points earned yet.</p> : <ul className="space-y-1">{c.loyalty.map((l) => (
                <li key={l.id} className="flex justify-between rounded-lg border border-line bg-white px-3 py-1.5"><span>{titleCase(l.type)} · {fmtDateTime(l.createdAt)}</span><span className={`font-medium tnum ${l.points < 0 ? 'text-rose' : 'text-sage-d'}`}>{l.points > 0 ? '+' : ''}{l.points}</span></li>))}</ul>}</div>
          </div>)}
      </Modal>
      {receiptId && <ReceiptModal orderId={receiptId.id} reprint={!!receiptId.receiptNumber} title={receiptId.receiptNumber ? `Receipt ${receiptId.receiptNumber}` : 'Bill'} onClose={() => setReceiptId(null)} />}
    </>
  );
}
