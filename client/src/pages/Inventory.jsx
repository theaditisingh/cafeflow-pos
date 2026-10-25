import { useState } from 'react';
import { Plus, Pencil, SlidersHorizontal, PackagePlus, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../api.js';
import { toPaise, fromPaise } from '../util.js';
import {
  Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, Empty, Badge, PageHeader, Tabs, Table, Th, Td, useAsync, useUi, inr, fmtDateTime, titleCase,
} from '../ui.jsx';

const UNITS = ['g', 'kg', 'ml', 'l', 'pcs'];
const qty = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function Inventory() {
  const [tab, setTab] = useState('stock');
  const ings = useAsync(() => api.get('/inventory/ingredients'), []);
  const sups = useAsync(() => api.get('/inventory/suppliers'), []);
  const lowCount = ings.data?.filter((i) => i.low).length ?? 0;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Inventory & suppliers" subtitle="Stock changes only through purchases, adjustments and orders, so every movement is on record." />
      {lowCount > 0 && (
        <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-d/30 bg-amber-l/80 px-4 py-3 text-sm font-medium text-amber-d shadow-xs">
          <AlertTriangle size={17} className="shrink-0" />
          <span><b>{lowCount}</b> ingredient{lowCount > 1 ? 's are' : ' is'} at or below the minimum stock level.</span>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[['stock', 'Stock'], ['purchases', 'Purchases'], ['suppliers', 'Suppliers'], ['recipes', 'Recipes'], ['movements', 'Stock movements']]} />
      {tab === 'stock' && <Stock ings={ings} />}
      {tab === 'purchases' && <Purchases ings={ings} sups={sups} />}
      {tab === 'suppliers' && <Suppliers sups={sups} />}
      {tab === 'recipes' && <Recipes ings={ings} />}
      {tab === 'movements' && <Movements ings={ings} />}
    </div>
  );
}

/* ---------------- Stock ---------------- */
function Stock({ ings }) {
  const [edit, setEdit] = useState(null);
  const [adjust, setAdjust] = useState(null);
  return (
    <>
      <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => setEdit({})}><Plus size={15} />Add ingredient</Button></div>
      <Card className="overflow-hidden">
        {ings.loading ? <Spinner /> : ings.error ? <ErrorBox error={ings.error} onRetry={ings.reload} /> : !ings.data.length ? <Empty title="No ingredients yet" hint="Add ingredients, then map them to menu items under Recipes." /> : (
          <Table><thead><tr><Th>Ingredient</Th><Th right>In stock</Th><Th right>Minimum</Th><Th right>Cost / unit</Th><Th>Status</Th><Th right> </Th></tr></thead><tbody>
            {ings.data.map((i) => (
              <tr key={i.id} className="hover:bg-cream-2/50">
                <Td className="font-medium">{i.name}{i.allowNegative && <span className="ml-2 text-xs text-ink-3">(negative allowed)</span>}</Td>
                <Td right>{qty(i.stockQty)} {i.unit}</Td><Td right>{qty(i.minStockQty)} {i.unit}</Td><Td right>{inr(i.costPerUnitPaise)}</Td>
                <Td>{i.stockQty < 0 ? <Badge tone="red">Negative</Badge> : i.low ? <Badge tone="amber">Low stock</Badge> : <Badge tone="green">OK</Badge>}</Td>
                <Td right><div className="flex justify-end gap-1">
                  <Button size="sm" onClick={() => setAdjust(i)}><SlidersHorizontal size={14} />Adjust</Button>
                  <Button size="sm" variant="ghost" aria-label={`Edit ${i.name}`} onClick={() => setEdit(i)}><Pencil size={14} /></Button></div></Td>
              </tr>))}
          </tbody></Table>)}
      </Card>
      {edit && <IngredientForm ing={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); ings.refresh(); }} />}
      {adjust && <AdjustForm ing={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); ings.refresh(); }} />}
    </>
  );
}

function IngredientForm({ ing, onClose, onSaved }) {
  const { toast } = useUi();
  const [f, setF] = useState({ name: ing.name ?? '', unit: ing.unit ?? 'g', min: ing.minStockQty ?? 0, cost: fromPaise(ing.costPerUnitPaise ?? 0), allowNegative: !!ing.allowNegative });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const body = { name: f.name, unit: f.unit, minStockQty: Number(f.min), costPerUnitPaise: toPaise(f.cost), allowNegative: f.allowNegative };
    if (Number.isNaN(body.costPerUnitPaise) || Number.isNaN(body.minStockQty)) return setErr('Enter valid numbers for minimum stock and cost.');
    setBusy(true); setErr('');
    try { ing.id ? await api.put(`/inventory/ingredients/${ing.id}`, body) : await api.post('/inventory/ingredients', body); toast('Ingredient saved'); onSaved(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={ing.id ? 'Edit ingredient' : 'New ingredient'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><Input autoFocus value={f.name} onChange={set('name')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit"><Select value={f.unit} onChange={set('unit')}>{UNITS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
          <Field label="Minimum stock" hint="Low-stock alert at or below this."><Input type="number" min="0" step="any" value={f.min} onChange={set('min')} /></Field>
        </div>
        <Field label="Cost per unit (₹)"><Input type="number" min="0" step="0.01" value={f.cost} onChange={set('cost')} /></Field>
        {ing.id && <p className="text-xs text-ink-3">Stock quantity is changed with Adjust or a purchase, not here.</p>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={f.allowNegative} onChange={set('allowNegative')} />
          <span>Allow stock to go negative<span className="block text-xs text-ink-3">Orders still go through when this ingredient runs out. Leave off to block them instead.</span></span></label>
        {err && <div className="rounded-lg bg-rose-l px-3 py-2 text-sm text-rose">{err}</div>}
      </div>
    </Modal>
  );
}

function AdjustForm({ ing, onClose, onSaved }) {
  const { toast } = useUi();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const d = Number(delta);
  const valid = delta !== '' && Number.isFinite(d) && d !== 0 && reason.trim().length >= 3;
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.post('/inventory/adjustments', { ingredientId: ing.id, delta: d, reason: reason.trim() }); toast('Stock adjusted'); onSaved(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Adjust stock · ${ing.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={save}>Apply adjustment</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-2">Currently <b>{qty(ing.stockQty)} {ing.unit}</b>. Use a negative number to remove stock (wastage, spillage, count correction).</p>
        <Field label={`Change (${ing.unit})`} hint={valid ? `New stock: ${qty(ing.stockQty + d)} ${ing.unit}` : undefined}><Input autoFocus type="number" step="any" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="e.g. -250 or 500" /></Field>
        <Field label="Reason (required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Spoilage, stock count correction" maxLength={200} /></Field>
        {err && <div className="rounded-lg bg-rose-l px-3 py-2 text-sm text-rose">{err}</div>}
      </div>
    </Modal>
  );
}

/* ---------------- Purchases ---------------- */
function Purchases({ ings, sups }) {
  const list = useAsync(() => api.get('/inventory/purchases'), []);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => setOpen(true)}><PackagePlus size={15} />Record purchase</Button></div>
      <Card className="overflow-hidden">
        {list.loading ? <Spinner /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data.length ? <Empty title="No purchases recorded" hint="Record stock you buy from suppliers; it is added to stock automatically." /> : (
          <Table><thead><tr><Th>Date</Th><Th>Supplier</Th><Th>Ingredient</Th><Th>Invoice</Th><Th right>Quantity</Th><Th right>Unit cost</Th><Th right>Total</Th></tr></thead><tbody>
            {list.data.map((p) => <tr key={p.id}><Td>{fmtDateTime(p.createdAt)}</Td><Td>{p.supplier}</Td><Td>{p.ingredient}</Td><Td>{p.invoiceNo ?? '—'}</Td><Td right>{qty(p.quantity)} {p.unit}</Td><Td right>{inr(p.unitCostPaise)}</Td><Td right>{inr(p.totalPaise)}</Td></tr>)}
          </tbody></Table>)}
      </Card>
      {open && <PurchaseForm ings={ings.data ?? []} sups={sups.data ?? []} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); list.refresh(); ings.refresh(); }} />}
    </>
  );
}

function PurchaseForm({ ings, sups, onClose, onSaved }) {
  const { toast } = useUi();
  const [f, setF] = useState({ supplierId: sups[0]?.id ?? '', ingredientId: ings[0]?.id ?? '', quantity: '', cost: '', invoiceNo: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ing = ings.find((i) => i.id === Number(f.ingredientId));
  const q = Number(f.quantity), cost = toPaise(f.cost);
  const valid = f.supplierId && f.ingredientId && q > 0 && cost >= 0;
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.post('/inventory/purchases', { supplierId: Number(f.supplierId), ingredientId: Number(f.ingredientId), quantity: q, unitCostPaise: cost, ...(f.invoiceNo ? { invoiceNo: f.invoiceNo } : {}) }); toast('Purchase recorded and stock updated'); onSaved(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  if (!sups.length || !ings.length) return <Modal title="Record purchase" onClose={onClose}><p className="text-sm">Add at least one supplier and one ingredient first.</p></Modal>;
  return (
    <Modal title="Record purchase" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={save}>Save purchase</Button></>}>
      <div className="space-y-3">
        <Field label="Supplier"><Select value={f.supplierId} onChange={set('supplierId')}>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Ingredient"><Select value={f.ingredientId} onChange={set('ingredientId')}>{ings.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Quantity${ing ? ` (${ing.unit})` : ''}`}><Input type="number" min="0" step="any" value={f.quantity} onChange={set('quantity')} /></Field>
          <Field label={`Cost per ${ing?.unit ?? 'unit'} (₹)`}><Input type="number" min="0" step="0.01" value={f.cost} onChange={set('cost')} /></Field>
        </div>
        <Field label="Invoice no. (optional)"><Input value={f.invoiceNo} maxLength={40} onChange={set('invoiceNo')} /></Field>
        {valid && <div className="text-sm text-ink-2">Total: <b>{inr(Math.round(q * cost))}</b></div>}
        {err && <div className="rounded-lg bg-rose-l px-3 py-2 text-sm text-rose">{err}</div>}
      </div>
    </Modal>
  );
}

/* ---------------- Suppliers ---------------- */
function Suppliers({ sups }) {
  const { toast, confirm } = useUi();
  const [edit, setEdit] = useState(null);
  const remove = async (s) => {
    if (!(await confirm({ title: `Delete ${s.name}?`, message: 'Suppliers with purchase history cannot be deleted.', confirmLabel: 'Delete supplier', danger: true }))) return;
    try { await api.del(`/inventory/suppliers/${s.id}`); toast('Supplier deleted'); sups.refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => setEdit({})}><Plus size={15} />Add supplier</Button></div>
      <Card className="overflow-hidden">
        {sups.loading ? <Spinner /> : sups.error ? <ErrorBox error={sups.error} onRetry={sups.reload} /> : !sups.data.length ? <Empty title="No suppliers yet" /> : (
          <Table><thead><tr><Th>Supplier</Th><Th>Contact</Th><Th>Phone</Th><Th>Email</Th><Th right> </Th></tr></thead><tbody>
            {sups.data.map((s) => (
              <tr key={s.id}><Td className="font-medium">{s.name}</Td><Td>{s.contactPerson ?? '—'}</Td><Td>{s.phone ?? '—'}</Td><Td>{s.email ?? '—'}</Td>
                <Td right><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEdit(s)}><Pencil size={14} /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => remove(s)}><Trash2 size={14} /></Button></div></Td></tr>))}
          </tbody></Table>)}
      </Card>
      {edit && <SupplierForm sup={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); sups.refresh(); }} />}
    </>
  );
}

function SupplierForm({ sup, onClose, onSaved }) {
  const { toast } = useUi();
  const [f, setF] = useState({ name: sup.name ?? '', contactPerson: sup.contactPerson ?? '', phone: sup.phone ?? '', email: sup.email ?? '', address: sup.address ?? '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setErr('');
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, k === 'name' ? v : v.trim() || null]));
    try { sup.id ? await api.put(`/inventory/suppliers/${sup.id}`, body) : await api.post('/inventory/suppliers', body); toast('Supplier saved'); onSaved(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={sup.id ? 'Edit supplier' : 'New supplier'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Supplier name"><Input autoFocus value={f.name} onChange={set('name')} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Contact person"><Input value={f.contactPerson} onChange={set('contactPerson')} /></Field><Field label="Phone"><Input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field></div>
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Address"><Input value={f.address} onChange={set('address')} /></Field>
        {err && <div className="rounded-lg bg-rose-l px-3 py-2 text-sm text-rose">{err}</div>}
      </div>
    </Modal>
  );
}

/* ---------------- Recipes ---------------- */
function Recipes({ ings }) {
  const { toast } = useUi();
  const menu = useAsync(() => api.get('/menu/items'), []);
  const recipes = useAsync(() => api.get('/inventory/recipes'), []);
  const [itemId, setItemId] = useState('');
  const [lines, setLines] = useState(null);
  const [busy, setBusy] = useState(false);

  const pick = (id) => {
    setItemId(id);
    setLines(id ? (recipes.data ?? []).filter((r) => r.menuItemId === Number(id)).map((r) => ({ ingredientId: r.ingredientId, quantity: String(r.quantity) })) : null);
  };
  const setLine = (idx, patch) => setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const used = new Set((lines ?? []).map((l) => Number(l.ingredientId)));
  const available = (ings.data ?? []).filter((i) => !used.has(i.id));
  const valid = lines && lines.every((l) => l.ingredientId && Number(l.quantity) > 0);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/inventory/recipes/${itemId}`, { lines: lines.map((l) => ({ ingredientId: Number(l.ingredientId), quantity: Number(l.quantity) })) });
      toast('Recipe saved'); recipes.refresh();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (menu.loading || recipes.loading || ings.loading) return <Spinner />;
  if (menu.error || recipes.error) return <ErrorBox error={menu.error || recipes.error} onRetry={() => { menu.reload(); recipes.reload(); }} />;
  const withRecipe = new Set(recipes.data.map((r) => r.menuItemId));

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Card className="max-h-[32rem] overflow-y-auto p-1.5">
        {menu.data.map((m) => (
          <button key={m.id} onClick={() => pick(String(m.id))} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${String(m.id) === itemId ? 'bg-terra-l text-terra-d' : 'hover:bg-cream-2'}`}>
            <span className="truncate">{m.name}</span>{withRecipe.has(m.id) ? <Badge tone="green">{recipes.data.filter((r) => r.menuItemId === m.id).length} items</Badge> : <span className="text-xs text-ink-3">none</span>}
          </button>))}
      </Card>
      <Card className="p-4">
        {!lines ? <Empty title="Select a menu item" hint="Define what each portion uses. Ingredients are deducted when an order is sent to the kitchen, and put back if it is cancelled before the kitchen starts preparing it." /> : (
          <div className="space-y-3">
            <h3 className="font-semibold">{menu.data.find((m) => m.id === Number(itemId))?.name} <span className="font-normal text-ink-3">· per portion</span></h3>
            {!lines.length && <p className="text-sm text-ink-3">No ingredients mapped, so nothing is deducted for this item.</p>}
            {lines.map((l, idx) => {
              const ing = (ings.data ?? []).find((i) => i.id === Number(l.ingredientId));
              return (
                <div key={idx} className="flex items-center gap-2">
                  <Select className="flex-1" value={l.ingredientId} onChange={(e) => setLine(idx, { ingredientId: e.target.value })}>
                    {ing && <option value={ing.id}>{ing.name}</option>}{available.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>
                  <Input className="w-28" type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} aria-label="Quantity" />
                  <span className="w-8 text-sm text-ink-3">{ing?.unit}</span>
                  <Button size="sm" variant="ghost" aria-label="Remove ingredient" onClick={() => setLines(lines.filter((_, i) => i !== idx))}><Trash2 size={14} /></Button>
                </div>);
            })}
            <div className="flex justify-between pt-1">
              <Button disabled={!available.length} onClick={() => setLines([...lines, { ingredientId: available[0].id, quantity: '' }])}><Plus size={14} />Add ingredient</Button>
              <Button variant="primary" loading={busy} disabled={!valid} onClick={save}>Save recipe</Button>
            </div>
          </div>)}
      </Card>
    </div>
  );
}

/* ---------------- Movements ---------------- */
function Movements({ ings }) {
  const [ingId, setIngId] = useState('');
  const { data, error, loading, reload } = useAsync(() => api.get(`/inventory/movements${ingId ? `?ingredientId=${ingId}` : ''}`), [ingId]);
  const tone = { PURCHASE: 'green', ADJUSTMENT: 'blue', ORDER_DEDUCTION: 'amber', ORDER_RESTORE: 'terra' };
  return (
    <>
      <div className="mb-3 max-w-xs"><Select value={ingId} onChange={(e) => setIngId(e.target.value)} aria-label="Filter by ingredient"><option value="">All ingredients</option>{(ings.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
      <Card className="overflow-hidden">
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.length ? <Empty title="No stock movements yet" /> : (
          <Table><thead><tr><Th>Time</Th><Th>Ingredient</Th><Th>Type</Th><Th right>Change</Th><Th>Reason</Th><Th>By</Th></tr></thead><tbody>
            {data.map((m) => <tr key={m.id}><Td>{fmtDateTime(m.createdAt)}</Td><Td>{m.ingredient}</Td><Td><Badge tone={tone[m.type]}>{titleCase(m.type)}</Badge></Td>
              <Td right><span className={m.quantity < 0 ? 'text-rose' : 'text-sage-d'}>{m.quantity > 0 ? '+' : ''}{qty(m.quantity)} {m.unit}</span></Td><Td>{m.reason ?? '—'}</Td><Td>{m.by ?? 'System'}</Td></tr>)}
          </tbody></Table>)}
      </Card>
    </>
  );
}
