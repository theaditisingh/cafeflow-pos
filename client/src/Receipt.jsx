import { Printer } from 'lucide-react';
import { api } from './api.js';
import { Button, Modal, Spinner, ErrorBox, useAsync, inr, fmtDateTime, titleCase } from './ui.jsx';

const dash = <div className="my-1.5 border-t border-dashed border-black" />;
const Row = ({ l, r, bold }) => <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}><span>{l}</span><span className="tnum">{r}</span></div>;

export function ReceiptPaper({ data }) {
  const { cafe, order: o } = data;
  const pay = o.payments.find((p) => p.status === 'SUCCESS') ?? o.payments[0];
  const where = o.type === 'DINE_IN' ? `Dine-in · Table ${o.table?.name ?? ''}` : titleCase(o.type);
  return (
    <div id="receipt-print" className="receipt-paper mx-auto shadow-md">
      <div className="text-center"><div className="text-sm font-bold uppercase">{cafe.name}</div><div>{cafe.address}</div><div>Ph: {cafe.phone}</div></div>
      {dash}
      <Row l="Receipt" r={o.receiptNumber ?? '— unpaid —'} />
      <Row l="Order" r={o.orderNumber} />
      <Row l="Date" r={fmtDateTime(o.completedAt ?? o.createdAt)} />
      <div>{where}</div>
      {o.customerName && <div>Customer: {o.customerName}{o.customerPhone ? ` (${o.customerPhone})` : ''}</div>}
      {dash}
      {o.items.map((i) => (
        <div key={i.id} className="mb-1">
          <div className="flex justify-between gap-2"><span>{i.quantity} x {i.name}{i.variantName ? ` (${i.variantName})` : ''}</span><span className="tnum">{inr(i.lineSubtotalPaise)}</span></div>
          {i.addons?.map((a) => <div key={a.name} className="pl-3">+ {a.name}</div>)}
          {i.notes && <div className="pl-3 italic">* {i.notes}</div>}
        </div>
      ))}
      {dash}
      <Row l="Subtotal" r={inr(o.subtotalPaise)} />
      {o.discountPaise > 0 && <Row l="Discount" r={`-${inr(o.discountPaise)}`} />}
      <Row l={cafe.taxInclusive ? 'Tax (included)' : 'Tax'} r={inr(o.taxPaise)} />
      <div className="mt-1 border-t border-black pt-1"><Row l="TOTAL" r={inr(o.totalPaise)} bold /></div>
      {pay && <>{dash}<Row l="Paid by" r={pay.method} />
        {pay.method === 'CASH' && <><Row l="Cash received" r={inr(pay.cashReceivedPaise)} /><Row l="Change" r={inr(pay.changePaise)} /></>}
        {pay.reference && <Row l="Ref" r={pay.reference} />}
        {pay.status !== 'SUCCESS' && <div className="font-bold">PAYMENT {pay.status}</div>}</>}
      {dash}
      <div className="text-center">{cafe.footer}</div>
      {data.demo && <div className="mt-1 text-center text-[10px] font-bold">*** DEMO ORDER — NOT A TAX INVOICE ***</div>}
    </div>
  );
}

export function ReceiptModal({ orderId, reprint, onClose, title = 'Receipt' }) {
  const { data, error, loading, reload } = useAsync(() => api.get(`/orders/${orderId}/receipt${reprint ? '?reprint=1' : ''}`), [orderId, reprint]);
  return (
    <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" disabled={!data} onClick={() => window.print()}><Printer size={16} />Print receipt</Button></>}>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : <div className="overflow-x-auto rounded-xl border border-line/70 bg-cream-2/60 p-4 shadow-inner"><ReceiptPaper data={data} /></div>}
    </Modal>
  );
}
