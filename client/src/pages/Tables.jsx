import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, Clock, Pencil } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Button, Card, Field, Input, Modal, Select, Spinner, ErrorBox, Empty, StatusBadge, PageHeader, cx, inr, useAsync, usePoll, useUi, titleCase } from '../ui.jsx';

const EDGE = {
  AVAILABLE: 'border-sage/40 hover:border-sage/80 shadow-xs',
  OCCUPIED: 'border-terra shadow-xs bg-gradient-to-b from-white to-terra-l/15',
  RESERVED: 'border-sky/50 hover:border-sky/80 shadow-xs',
  CLEANING: 'border-amber-d/40 hover:border-amber-d/80 shadow-xs',
};
const mins = (d) => Math.max(0, Math.round((Date.now() - new Date(d)) / 60000));

export default function Tables() {
  const { user } = useAuth();
  const { toast } = useUi();
  const nav = useNavigate();
  const { data, error, loading, reload, refresh } = useAsync(() => api.get('/tables'), []);
  usePoll(refresh, 8000);
  const [edit, setEdit] = useState(null);
  const canEdit = ['OWNER', 'MANAGER'].includes(user.role);

  const setStatus = async (t, status) => {
    try { await api.patch(`/tables/${t.id}/status`, { status }); toast(`Table ${t.name} marked ${status.toLowerCase()}`); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const counts = Object.fromEntries(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING'].map((s) => [s, data.filter((t) => t.status === s).length]));

  return (
    <div className="mx-auto max-w-7xl p-4">
      <PageHeader title="Floor plan" subtitle="Tap a table to start or continue an order." actions={canEdit && <Button variant="primary" onClick={() => setEdit({})}><Plus size={16} />Add table</Button>} />
      <div className="mb-5 flex flex-wrap gap-2 text-sm">{Object.entries(counts).map(([s, n]) => <span key={s} className="flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-1.5 shadow-2xs"><StatusBadge kind="table" value={s} /><b className="text-xs font-bold text-ink tnum">{n}</b></span>)}</div>
      {!data.length && <Empty title="No tables yet" hint="Add tables to use dine-in billing." />}
      {['INDOOR', 'OUTDOOR'].map((area) => {
        const list = data.filter((t) => t.area === area);
        if (!list.length) return null;
        return (
          <section key={area} className="mb-6"><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-3">{titleCase(area)}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((t) => (
                <Card key={t.id} className={cx('border-2 p-4 transition-all duration-200 hover:shadow-md', EDGE[t.status])}>
                  <div className="flex items-start justify-between"><div><div className="text-lg font-bold tracking-tight text-ink">{t.name}</div><div className="flex items-center gap-1.5 text-xs text-ink-3"><Users size={12} />Seats {t.capacity}</div></div>
                    <div className="flex items-center gap-1"><StatusBadge kind="table" value={t.status} />{canEdit && <button onClick={() => setEdit(t)} className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-cream-2 hover:text-ink" aria-label={`Edit table ${t.name}`}><Pencil size={13} /></button>}</div></div>
                  {t.order ? (
                    <div className="mt-3.5 rounded-xl border border-line/60 bg-cream-2/80 p-2.5 text-sm"><div className="flex justify-between"><span className="font-semibold text-ink">{t.order.orderNumber.split('-').pop()}</span><span className="font-bold text-terra-d tnum">{inr(t.order.totalPaise)}</span></div>
                      <div className="mt-1 flex items-center justify-between text-xs text-ink-3"><span className="flex items-center gap-1"><Clock size={12} />{mins(t.order.createdAt)} min</span><StatusBadge kind="kitchen" value={t.order.kitchenStatus} /></div></div>
                  ) : <div className="mt-3.5 h-[62px]" />}
                  <div className="mt-3.5 flex gap-2">
                    {t.order ? <Button variant="primary" size="sm" className="flex-1 font-semibold" onClick={() => nav(`/pos?order=${t.order.id}`)}>View order / bill</Button>
                      : t.status === 'CLEANING' ? <Button size="sm" className="flex-1" onClick={() => setStatus(t, 'AVAILABLE')}>Mark clean</Button>
                      : <Button variant="primary" size="sm" className="flex-1 font-semibold" onClick={() => nav(`/pos?table=${t.id}`)}>Start order</Button>}
                    {!t.order && (t.status === 'AVAILABLE' ? <Button size="sm" onClick={() => setStatus(t, 'RESERVED')}>Reserve</Button> : t.status === 'RESERVED' ? <Button size="sm" onClick={() => setStatus(t, 'AVAILABLE')}>Release</Button> : null)}
                    {!t.order && t.status === 'AVAILABLE' && <Button size="sm" onClick={() => setStatus(t, 'CLEANING')}>Cleaning</Button>}
                  </div>
                </Card>
              ))}
            </div></section>
        );
      })}
      {edit && <TableModal table={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
    </div>
  );
}

function TableModal({ table, onClose, onSaved }) {
  const { toast, confirm } = useUi();
  const [f, setF] = useState({ name: table.name ?? '', area: table.area ?? 'INDOOR', capacity: table.capacity ?? 4 });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const body = { ...f, capacity: Number(f.capacity) }; table.id ? await api.put(`/tables/${table.id}`, body) : await api.post('/tables', body); toast('Table saved'); onSaved(); }
    catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  const del = async () => {
    if (!(await confirm({ title: `Delete table ${table.name}?`, message: 'Only tables without order history can be deleted.', confirmLabel: 'Delete', danger: true }))) return;
    try { await api.del(`/tables/${table.id}`); toast('Table deleted'); onSaved(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={table.id ? `Edit table ${table.name}` : 'Add table'} onClose={onClose} footer={<>{table.id && <Button variant="danger" className="mr-auto" onClick={del}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={save}>Save</Button></>}>
      <div className="space-y-3"><Field label="Table name / number"><Input value={f.name} maxLength={20} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Area"><Select value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}><option value="INDOOR">Indoor</option><option value="OUTDOOR">Outdoor</option></Select></Field>
        <Field label="Seating capacity"><Input type="number" min="1" max="30" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field></div>
    </Modal>
  );
}
