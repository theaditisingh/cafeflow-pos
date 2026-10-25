import { useState } from 'react';
import { Search, Printer, Undo2, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ReceiptModal } from '../Receipt.jsx';
import { qs } from '../util.js';
import { Button, Card, Field, Input, Modal, Select, Textarea, Spinner, ErrorBox, Empty, StatusBadge, DemoTag, PageHeader, Table, Th, Td, VegDot, useAsync, useUi, inr, fmtDateTime, titleCase } from '../ui.jsx';

const PAGE = 25;
const BLANK = { q: '', from: '', to: '', type: '', status: '', paymentStatus: '' };

export default function Orders() {
  const [draft, setDraft] = useState(BLANK);
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState(null);
  const query = qs({ ...f, limit: PAGE, offset: page * PAGE });
  const { data, error, loading, reload, refresh } = useAsync(() => api.get(`/orders?${query}`), [query]);
  const apply = (e) => { e?.preventDefault(); setPage(0); setF(draft); };
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <div className="mx-auto max-w-7xl p-4">
      <PageHeader title="Order history" subtitle="Search past orders, view details, reprint receipts, and record cancellations, refunds or voids." />
      <Card className="mb-4 p-4 shadow-sm">
        <form onSubmit={apply} className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Field label="Search" className="col-span-2"><Input placeholder="Order #, receipt #, customer, phone" value={draft.q} onChange={set('q')} /></Field>
          <Field label="From"><Input type="date" value={draft.from} onChange={set('from')} /></Field>
          <Field label="To"><Input type="date" value={draft.to} onChange={set('to')} /></Field>
          <Field label="Order type"><Select value={draft.type} onChange={set('type')}><option value="">All</option><option value="DINE_IN">Dine-in</option><option value="TAKEAWAY">Takeaway</option><option value="DELIVERY">Delivery</option></Select></Field>
          <Field label="Payment"><Select value={draft.paymentStatus} onChange={set('paymentStatus')}><option value="">All</option>{['UNPAID', 'PAID', 'REFUNDED', 'VOID'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
          <Field label="Order status"><Select value={draft.status} onChange={set('status')}><option value="">All</option>{['OPEN', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
          <div className="col-span-2 flex items-end gap-2 md:col-span-5 md:justify-end">
            <Button type="button" onClick={() => { setDraft(BLANK); setF(BLANK); setPage(0); }}>Clear</Button>
            <Button type="submit" variant="primary"><Search size={15} />Search</Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden shadow-sm">
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.rows.length ? <Empty title="No orders match" hint="Try clearing the filters or widening the date range." /> : (
          <Table>
            <thead><tr><Th>Order</Th><Th>Placed</Th><Th>Type</Th><Th>Customer</Th><Th>Order status</Th><Th>Kitchen</Th><Th>Payment</Th><Th right>Total</Th></tr></thead>
            <tbody>{data.rows.map((o) => (
              <tr key={o.id} onClick={() => setOpenId(o.id)} className="cursor-pointer transition-colors duration-150 hover:bg-cream-2/60">
                <Td><div className="flex items-center gap-1.5 font-semibold text-ink">{o.orderNumber}{o.isDemo && <DemoTag />}</div>{o.receiptNumber && <div className="text-xs text-ink-3">{o.receiptNumber}</div>}</Td>
                <Td className="text-ink-2">{fmtDateTime(o.createdAt)}</Td>
                <Td className="font-medium text-ink-2">{o.type === 'DINE_IN' ? `Table ${o.tableName ?? '—'}` : titleCase(o.type)}</Td>
                <Td>{o.customerName || <span className="text-ink-3">—</span>}</Td>
                <Td><StatusBadge kind="order" value={o.status} /></Td>
                <Td>{o.status === 'CANCELLED' ? <span className="text-ink-3">—</span> : <StatusBadge kind="kitchen" value={o.kitchenStatus} />}</Td>
                <Td><StatusBadge kind="payment" value={o.paymentStatus} /></Td>
                <Td right className="font-bold text-ink">{inr(o.totalPaise)}</Td>
              </tr>))}</tbody>
          </Table>
        )}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between border-t border-line bg-cream/30 px-4 py-3 text-sm text-ink-2">
            <span className="font-medium text-ink-3">{data.total} order{data.total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2"><Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs font-semibold text-ink-2">Page {page + 1} of {pages}</span><Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        )}
      </Card>
      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
}

function OrderDetail({ id, onClose, onChanged }) {
  const { user } = useAuth();
  const { toast, confirm } = useUi();
  const [version, setVersion] = useState(0);
  const { data: o, error, loading, reload } = useAsync(() => api.get(`/orders/${id}`), [id, version]);
  const [receipt, setReceipt] = useState(false);
  const [refund, setRefund] = useState(false);
  const canRefund = ['OWNER', 'MANAGER'].includes(user.role);
  const changed = () => { setVersion((v) => v + 1); onChanged(); };

  const cancel = async () => {
    const reason = await confirm({ title: 'Cancel this order?', message: `${o.orderNumber} will be cancelled. Any reserved stock is restored and the table is released.`, confirmLabel: 'Cancel order', danger: true, reason: { label: 'Reason for cancelling' } });
    if (!reason) return;
    try { await api.post(`/orders/${id}/cancel`, { reason }); toast('Order cancelled'); changed(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <Modal title={o ? `Order ${o.orderNumber}` : 'Order'} size="lg" onClose={onClose}
        footer={o && <>
          {o.paymentStatus === 'UNPAID' && o.status !== 'CANCELLED' && <Button variant="danger" onClick={cancel}><XCircle size={15} />Cancel order</Button>}
          {o.paymentStatus === 'PAID' && canRefund && <Button onClick={() => setRefund(true)}><Undo2 size={15} />Refund / void</Button>}
          {o.status !== 'CANCELLED' && <Button variant="primary" onClick={() => setReceipt(true)}><Printer size={15} />{o.receiptNumber ? 'Reprint receipt' : 'View bill'}</Button>}
        </>}>
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="order" value={o.status} /><StatusBadge kind="payment" value={o.paymentStatus} />{o.status !== 'CANCELLED' && <StatusBadge kind="kitchen" value={o.kitchenStatus} />}
              <StatusBadge kind="type" value={o.type} />{o.isDemo && <DemoTag />}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
              {[['Placed', fmtDateTime(o.createdAt)], ['Table', o.table?.name ?? '—'], ['Customer', o.customerName ? `${o.customerName}${o.customerPhone ? ` · ${o.customerPhone}` : ''}` : '—'],
                ['KOT', o.kotNumber ?? '—'], ['Receipt', o.receiptNumber ?? '—'], ['Completed', fmtDateTime(o.completedAt)]].map(([k, v]) => (
                <div key={k}><dt className="text-xs text-ink-3">{k}</dt><dd className="font-medium">{v}</dd></div>))}
            </dl>
            {o.cancelReason && <div className="rounded-lg bg-rose-l p-2.5 text-rose">Cancelled: {o.cancelReason}</div>}
            <Card className="overflow-hidden"><Table><thead><tr><Th>Item</Th><Th right>Qty</Th><Th right>Rate</Th><Th right>Amount</Th></tr></thead><tbody>
              {o.items.map((i) => (
                <tr key={i.id}><Td><div className="flex items-center gap-1.5"><VegDot veg={i.isVeg} />{i.name}{i.variantName ? <span className="text-ink-3"> ({i.variantName})</span> : ''}</div>
                  {i.addons?.length > 0 && <div className="pl-5 text-xs text-ink-3">+ {i.addons.map((a) => a.name).join(', ')}</div>}{i.notes && <div className="pl-5 text-xs italic text-ink-3">“{i.notes}”</div>}</Td>
                  <Td right>{i.quantity}</Td><Td right>{inr(i.unitPricePaise)}</Td><Td right>{inr(i.lineSubtotalPaise)}</Td></tr>))}
            </tbody></Table></Card>
            <div className="ml-auto max-w-xs space-y-1">
              <div className="flex justify-between"><span className="text-ink-3">Subtotal</span><span className="tnum">{inr(o.subtotalPaise)}</span></div>
              {o.discountPaise > 0 && <div className="flex justify-between"><span className="text-ink-3">Discount</span><span className="tnum">-{inr(o.discountPaise)}</span></div>}
              <div className="flex justify-between"><span className="text-ink-3">Tax</span><span className="tnum">{inr(o.taxPaise)}</span></div>
              <div className="flex justify-between border-t border-line pt-1 text-base font-semibold"><span>Total</span><span className="tnum">{inr(o.totalPaise)}</span></div>
            </div>
            <div><h3 className="mb-1.5 font-semibold">Payments</h3>
              {!o.payments.length ? <p className="text-ink-3">No payment recorded.</p> : <ul className="space-y-1.5">{o.payments.map((p) => (
                <li key={p.id} className="rounded-lg border border-line bg-white px-3 py-2">
                  <div className="flex justify-between"><span>{titleCase(p.method)}{p.reference ? ` · ref ${p.reference}` : ''}</span><span className="font-medium tnum">{inr(p.amountPaise)}</span></div>
                  <div className="text-xs text-ink-3">{fmtDateTime(p.createdAt)}{p.method === 'CASH' && p.cashReceivedPaise != null ? ` · received ${inr(p.cashReceivedPaise)}, change ${inr(p.changePaise)}` : ''}
                    {p.status !== 'SUCCESS' && <span className="ml-2 font-semibold text-rose">{titleCase(p.status)}{p.refundReason ? `: ${p.refundReason}` : ''}</span>}</div>
                </li>))}</ul>}
              <p className="mt-1.5 text-xs text-ink-3">Payments are recorded by staff. CafeFlow does not process UPI or card transactions.</p>
            </div>
          </div>
        )}
      </Modal>
      {receipt && o && <ReceiptModal orderId={id} reprint={!!o.receiptNumber} title={o.receiptNumber ? `Receipt ${o.receiptNumber}` : 'Bill'} onClose={() => setReceipt(false)} />}
      {refund && o && <RefundModal order={o} onClose={() => setRefund(false)} onDone={() => { setRefund(false); changed(); }} />}
    </>
  );
}

function RefundModal({ order, onClose, onDone }) {
  const { toast } = useUi();
  const [type, setType] = useState('REFUND');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/orders/${order.id}/refund`, { type, reason: reason.trim() }); toast(type === 'VOID' ? 'Payment voided' : 'Payment refunded'); onDone(); }
    catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  return (
    <Modal title={`Refund / void ${order.orderNumber}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Keep as is</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={submit}>{type === 'VOID' ? 'Void payment' : `Refund ${inr(order.totalPaise)}`}</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-2">The full amount of {inr(order.totalPaise)} is reversed in the records and the action is written to the audit log. Money is returned to the customer outside CafeFlow.</p>
        <Field label="Type" hint="Void: payment entered by mistake. Refund: customer is repaid after a valid sale."><Select value={type} onChange={(e) => setType(e.target.value)}><option value="REFUND">Refund</option><option value="VOID">Void</option></Select></Field>
        <Field label="Reason (kept in the audit log)"><Textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Enter a short reason" /></Field>
      </div>
    </Modal>
  );
}
