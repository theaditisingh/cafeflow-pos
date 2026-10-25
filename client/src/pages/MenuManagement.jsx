import { useState } from 'react';
import { Plus, Pencil, Trash2, EyeOff, Eye, Search, X } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { toPaise, fromPaise, bpToPercent, percentToBp } from '../util.js';
import { Button, Card, Field, Input, Modal, Select, Textarea, Spinner, ErrorBox, Empty, Badge, VegDot, PageHeader, Table, Th, Td, cx, useAsync, useUi, inr, titleCase } from '../ui.jsx';

export default function MenuManagement() {
  const { toast, confirm } = useUi();
  const { settings } = useAuth();
  const cats = useAsync(() => api.get('/menu/categories'), []);
  const items = useAsync(() => api.get('/menu/items'), []);
  const [catFilter, setCatFilter] = useState('');
  const [q, setQ] = useState('');
  const [editItem, setEditItem] = useState(null);   // item | {} for new
  const [editCat, setEditCat] = useState(null);

  const reloadAll = () => { cats.refresh(); items.refresh(); };
  const toggle = async (i) => {
    try { await api.patch(`/menu/items/${i.id}/availability`, { available: !i.available }); toast(`${i.name} marked ${i.available ? 'out of stock' : 'available'}`); items.refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  const archive = async (i) => {
    if (!(await confirm({ title: `Remove ${i.name}?`, message: 'The item is archived: it disappears from the menu, but past orders and receipts keep their original name and price.', confirmLabel: 'Remove item', danger: true }))) return;
    try { await api.del(`/menu/items/${i.id}`); toast('Item removed'); items.refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  const removeCat = async (c) => {
    if (!(await confirm({ title: `Remove category ${c.name}?`, message: 'A category can only be removed once it has no menu items.', confirmLabel: 'Remove category', danger: true }))) return;
    try { await api.del(`/menu/categories/${c.id}`); toast('Category removed'); if (String(catFilter) === String(c.id)) setCatFilter(''); reloadAll(); } catch (e) { toast(e.message, 'error'); }
  };

  if (cats.loading || items.loading) return <Spinner />;
  if (cats.error || items.error) return <ErrorBox error={cats.error || items.error} onRetry={reloadAll} />;
  const catName = Object.fromEntries(cats.data.map((c) => [c.id, c.name]));
  const shown = items.data.filter((i) => (!catFilter || String(i.categoryId) === String(catFilter)) && (!q || i.name.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="mx-auto max-w-7xl p-4">
      <PageHeader title="Menu management" subtitle="Changes apply to new orders only. Existing orders and receipts keep the name, price and tax they were sold with."
        actions={<><Button onClick={() => setEditCat({})}><Plus size={15} />Category</Button><Button variant="primary" onClick={() => setEditItem({})} disabled={!cats.data.length}><Plus size={15} />Menu item</Button></>} />
      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <Card className="h-fit p-2.5 shadow-sm">
          <div className="mb-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wider text-ink-3">Categories</div>
          <button onClick={() => setCatFilter('')} className={cx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-all duration-150', !catFilter ? 'bg-terra-l text-terra-d shadow-2xs font-semibold' : 'text-ink-2 hover:bg-cream-2 hover:text-ink')}>
            All items<span className="rounded-full bg-cream-2/80 px-2 py-0.5 text-xs font-semibold text-ink-3">{items.data.length}</span>
          </button>
          <div className="mt-1 space-y-0.5">
            {cats.data.map((c) => (
              <div key={c.id} className={cx('group flex items-center rounded-lg transition-all duration-150', String(catFilter) === String(c.id) ? 'bg-terra-l text-terra-d shadow-2xs font-semibold' : 'hover:bg-cream-2 text-ink-2 hover:text-ink')}>
                <button onClick={() => setCatFilter(c.id)} className="flex flex-1 items-center justify-between px-3 py-2 text-left text-sm">
                  <span className="truncate">{c.name}</span>
                  <span className="rounded-full bg-cream-2/80 px-2 py-0.5 text-xs font-semibold text-ink-3">{items.data.filter((i) => i.categoryId === c.id).length}</span>
                </button>
                <div className="flex pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button aria-label={`Rename ${c.name}`} onClick={() => setEditCat(c)} className="rounded p-1 text-ink-3 hover:bg-cream-2 hover:text-ink"><Pencil size={13} /></button>
                  <button aria-label={`Remove ${c.name}`} onClick={() => removeCat(c)} className="rounded p-1 text-ink-3 hover:bg-rose-l hover:text-rose"><Trash2 size={13} /></button>
                </div>
              </div>))}
          </div>
        </Card>
        <Card className="overflow-hidden shadow-sm">
          <div className="border-b border-line bg-cream/30 p-3"><div className="relative max-w-xs"><Search size={15} className="absolute left-3 top-2.5 text-ink-3" /><Input className="pl-9" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
          {!shown.length ? <Empty title="No menu items" hint={items.data.length ? 'No items match this filter.' : 'Add your first menu item.'} /> : (
            <Table><thead><tr><Th>Item</Th><Th>Category</Th><Th>Station</Th><Th right>Price</Th><Th right>Tax</Th><Th>Status</Th><Th right>Actions</Th></tr></thead><tbody>
              {shown.map((i) => (
                <tr key={i.id} className={cx('transition-colors duration-150 hover:bg-cream-2/50', !i.available && 'bg-cream-2/30 opacity-75')}>
                  <Td><div className="flex items-center gap-2.5"><VegDot veg={i.isVeg} /><div><div className="font-semibold text-ink">{i.name}</div>
                    <div className="text-xs text-ink-3">{i.variants.length ? `${i.variants.length} variant${i.variants.length > 1 ? 's' : ''}` : ''}{i.variants.length && i.addons.length ? ' · ' : ''}{i.addons.length ? `${i.addons.length} extra${i.addons.length > 1 ? 's' : ''}` : ''}</div></div></div></Td>
                  <Td className="font-medium text-ink-2">{catName[i.categoryId] ?? '—'}</Td><Td className="text-xs font-semibold text-ink-3 uppercase">{titleCase(i.station)}</Td><Td right className="font-bold text-ink">{inr(i.pricePaise)}</Td><Td right className="text-ink-2">{bpToPercent(i.taxRateBp)}%</Td>
                  <Td>{i.available ? <Badge tone="green">Available</Badge> : <Badge tone="red">Out of stock</Badge>}</Td>
                  <Td right><div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => toggle(i)} title={i.available ? 'Mark out of stock' : 'Mark available'}>{i.available ? <EyeOff size={15} /> : <Eye size={15} />}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditItem(i)} aria-label={`Edit ${i.name}`}><Pencil size={15} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => archive(i)} aria-label={`Remove ${i.name}`}><Trash2 size={15} className="text-rose" /></Button></div></Td>
                </tr>))}
            </tbody></Table>)}
        </Card>
      </div>
      {editItem && <ItemForm item={editItem} cats={cats.data} defaultTaxBp={settings?.defaultTaxRateBp ?? 500} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); items.refresh(); }} />}
      {editCat && <CategoryForm cat={editCat} onClose={() => setEditCat(null)} onSaved={() => { setEditCat(null); reloadAll(); }} />}
    </div>
  );
}

function CategoryForm({ cat, onClose, onSaved }) {
  const { toast } = useUi();
  const [name, setName] = useState(cat.name ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { cat.id ? await api.put(`/menu/categories/${cat.id}`, { name }) : await api.post('/menu/categories', { name }); toast('Category saved'); onSaved(); } catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  return (
    <Modal title={cat.id ? 'Rename category' : 'New category'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>Save</Button></>}>
      <Field label="Category name"><Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} /></Field>
    </Modal>
  );
}

function ItemForm({ item, cats, defaultTaxBp, onClose, onSaved }) {
  const { toast } = useUi();
  const isNew = !item.id;
  const [f, setF] = useState({
    name: item.name ?? '', categoryId: item.categoryId ?? cats[0]?.id, description: item.description ?? '', imageUrl: item.imageUrl ?? '',
    price: fromPaise(item.pricePaise), tax: bpToPercent(item.taxRateBp ?? defaultTaxBp), station: item.station ?? 'KITCHEN', isVeg: item.isVeg ?? true, available: item.available ?? true,
  });
  const [variants, setVariants] = useState((item.variants ?? []).map((v) => ({ name: v.name, delta: fromPaise(v.priceDeltaPaise) || '0' })));
  const [addons, setAddons] = useState((item.addons ?? []).map((a) => ({ name: a.name, price: fromPaise(a.pricePaise) || '0' })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async () => {
    const pricePaise = toPaise(f.price);
    const taxRateBp = percentToBp(f.tax);
    if (!f.name.trim()) return setErr('Enter an item name');
    if (!Number.isInteger(pricePaise) || pricePaise < 0) return setErr('Enter a valid price in rupees');
    if (!Number.isInteger(taxRateBp) || taxRateBp < 0 || taxRateBp > 10000) return setErr('Tax must be between 0 and 100%');
    const vs = variants.filter((v) => v.name.trim()).map((v) => ({ name: v.name.trim(), priceDeltaPaise: toPaise(v.delta || 0) }));
    const as = addons.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), pricePaise: toPaise(a.price || 0) }));
    if ([...vs.map((v) => v.priceDeltaPaise), ...as.map((a) => a.pricePaise)].some((n) => !Number.isInteger(n))) return setErr('Check the variant and extra prices');
    setErr(''); setBusy(true);
    const body = { name: f.name.trim(), categoryId: Number(f.categoryId), description: f.description.trim(), imageUrl: f.imageUrl.trim() || null, pricePaise, taxRateBp, station: f.station, isVeg: f.isVeg, available: f.available, variants: vs, addons: as };
    try { isNew ? await api.post('/menu/items', body) : await api.put(`/menu/items/${item.id}`, body); toast(isNew ? 'Menu item added' : 'Menu item updated'); onSaved(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };

  const rows = (list, setList, cols, blank) => (
    <div className="space-y-1.5">
      {list.map((row, n) => (
        <div key={n} className="flex gap-2">
          {cols.map(([k, ph, w]) => <Input key={k} className={w} placeholder={ph} value={row[k]} onChange={(e) => setList(list.map((r, i) => (i === n ? { ...r, [k]: e.target.value } : r)))} />)}
          <Button variant="ghost" size="sm" aria-label="Remove row" onClick={() => setList(list.filter((_, i) => i !== n))}><X size={15} /></Button>
        </div>))}
      <Button size="sm" onClick={() => setList([...list, blank])}><Plus size={14} />Add</Button>
    </div>
  );

  return (
    <Modal title={isNew ? 'New menu item' : `Edit ${item.name}`} size="lg" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save item</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input autoFocus value={f.name} maxLength={100} onChange={set('name')} /></Field>
        <Field label="Category"><Select value={f.categoryId} onChange={set('categoryId')}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Price (₹)"><Input inputMode="decimal" value={f.price} onChange={set('price')} placeholder="0" /></Field>
        <Field label="Tax rate (%)" hint="Shown on the bill. Set what applies to your cafe."><Input inputMode="decimal" value={f.tax} onChange={set('tax')} /></Field>
        <Field label="Preparation station"><Select value={f.station} onChange={set('station')}><option value="BAR">Bar</option><option value="KITCHEN">Kitchen</option><option value="DESSERT">Dessert</option></Select></Field>
        <Field label="Image URL (optional)"><Input value={f.imageUrl} onChange={set('imageUrl')} placeholder="https://… or /images/x.jpg" /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={2} maxLength={500} value={f.description} onChange={set('description')} /></Field>
        <div className="flex gap-6 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isVeg} onChange={set('isVeg')} />Vegetarian</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.available} onChange={set('available')} />Available for ordering</label>
        </div>
        <div><h3 className="mb-1.5 text-sm font-semibold">Variants <span className="font-normal text-ink-3">(price change in ₹, e.g. Large +40)</span></h3>{rows(variants, setVariants, [['name', 'Name', 'flex-1'], ['delta', '± ₹', 'w-24']], { name: '', delta: '0' })}</div>
        <div><h3 className="mb-1.5 text-sm font-semibold">Optional extras <span className="font-normal text-ink-3">(add-ons)</span></h3>{rows(addons, setAddons, [['name', 'Name', 'flex-1'], ['price', '₹', 'w-24']], { name: '', price: '0' })}</div>
      </div>
      {err && <div className="mt-3 rounded-lg bg-rose-l px-3 py-2 text-sm text-rose">{err}</div>}
    </Modal>
  );
}
