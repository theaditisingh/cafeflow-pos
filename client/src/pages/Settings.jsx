import { useState } from 'react';
import { Plus, Pencil, Search } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { bpToPercent, percentToBp, qs } from '../util.js';
import {
  Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, Empty, Badge, PageHeader, Tabs, Table, Th, Td, useAsync, useUi, fmtDateTime, titleCase,
} from '../ui.jsx';

export default function SettingsPage() {
  const { user } = useAuth();
  const isOwner = user.role === 'OWNER';
  const [tab, setTab] = useState('cafe');
  const tabs = [['cafe', 'Cafe & billing'], ...(isOwner ? [['staff', 'Staff & roles']] : []), ['audit', 'Audit log']];
  return (
    <div className="mx-auto max-w-5xl p-4">
      <PageHeader title="Settings" subtitle="Cafe details, billing rules, staff accounts and the audit trail." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'cafe' && <CafeSettings />}
      {tab === 'staff' && isOwner && <Staff />}
      {tab === 'audit' && <AuditLog />}
    </div>
  );
}

/* ---------------- Cafe & billing ---------------- */
// Settings load asynchronously after sign-in/refresh, so the form mounts only once they exist.
function CafeSettings() {
  const { settings } = useAuth();
  return settings ? <CafeSettingsForm settings={settings} /> : <Spinner />;
}

function CafeSettingsForm({ settings }) {
  const { reloadSettings } = useAuth();
  const { toast } = useUi();
  const [f, setF] = useState(() => ({
    cafeName: settings.cafeName, address: settings.address, phone: settings.phone, receiptFooter: settings.receiptFooter,
    taxInclusive: settings.taxInclusive, defaultTax: bpToPercent(settings.defaultTaxRateBp), maxDisc: String(settings.maxDiscountPercentCashier),
    loyaltyEnabled: settings.loyaltyEnabled, loyaltyPoints: String(settings.loyaltyPointsPer100Rupees),
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const tax = Number(f.defaultTax), disc = Number(f.maxDisc), pts = Number(f.loyaltyPoints);
  const problem = !f.cafeName.trim() ? 'Cafe name is required.' : !(tax >= 0 && tax <= 100) ? 'Tax rate must be between 0 and 100%.'
    : !(disc >= 0 && disc <= 100) ? 'Cashier discount limit must be between 0 and 100%.' : !(Number.isInteger(pts) && pts >= 0) ? 'Loyalty points must be a whole number.' : '';

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.put('/settings', {
        cafeName: f.cafeName.trim(), address: f.address, phone: f.phone, receiptFooter: f.receiptFooter, taxInclusive: f.taxInclusive,
        defaultTaxRateBp: percentToBp(f.defaultTax), maxDiscountPercentCashier: disc, loyaltyEnabled: f.loyaltyEnabled, loyaltyPointsPer100Rupees: pts,
      });
      await reloadSettings(); toast('Settings saved');
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className="grid gap-5 lg:grid-cols-2">
      <Card className="space-y-4 p-5 shadow-sm">
        <h3 className="font-bold text-ink">Cafe details <span className="text-xs font-normal text-ink-3">(printed on receipts)</span></h3>
        <Field label="Cafe name"><Input value={f.cafeName} maxLength={80} onChange={set('cafeName')} /></Field>
        <Field label="Address"><Input value={f.address} maxLength={200} onChange={set('address')} /></Field>
        <Field label="Phone"><Input value={f.phone} maxLength={30} onChange={set('phone')} /></Field>
        <Field label="Receipt footer"><Input value={f.receiptFooter} maxLength={200} onChange={set('receiptFooter')} /></Field>
        <Field label="Currency"><Input value="INR (₹)" disabled readOnly className="bg-cream-2/50 text-ink-3" /></Field>
      </Card>
      <div className="space-y-5">
        <Card className="space-y-4 p-5 shadow-sm">
          <h3 className="font-bold text-ink">Tax & discounts</h3>
          <Field label="Default tax rate for new menu items (%)" hint="Each menu item keeps its own rate. Set it per item under Menu. Confirm the correct rate for your business with your accountant."><Input type="number" min="0" max="100" step="0.01" value={f.defaultTax} onChange={set('defaultTax')} /></Field>
          <label className="flex items-start gap-2.5 text-sm cursor-pointer"><input type="checkbox" className="mt-1 accent-[var(--color-terra)]" checked={f.taxInclusive} onChange={set('taxInclusive')} />
            <span><b className="font-medium text-ink">Menu prices include tax</b><span className="block text-xs text-ink-3">When on, tax is shown as part of the price instead of being added. Affects new and edited bills; paid bills never change.</span></span></label>
          <Field label="Maximum cashier discount (%)" hint="Managers and owners can exceed this."><Input type="number" min="0" max="100" step="0.5" value={f.maxDisc} onChange={set('maxDisc')} /></Field>
        </Card>
        <Card className="space-y-4 p-5 shadow-sm">
          <h3 className="font-bold text-ink">Loyalty</h3>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer"><input type="checkbox" className="accent-[var(--color-terra)]" checked={f.loyaltyEnabled} onChange={set('loyaltyEnabled')} /><span className="font-medium text-ink">Earn loyalty points on paid orders</span></label>
          <Field label="Points per ₹100 spent" hint="Points are based on the amount paid and are reversed if the payment is refunded or voided."><Input type="number" min="0" step="1" value={f.loyaltyPoints} onChange={set('loyaltyPoints')} disabled={!f.loyaltyEnabled} /></Field>
        </Card>
      </div>
      <div className="flex items-center justify-end gap-3 lg:col-span-2">
        {(problem || err) && <span className="text-sm text-rose">{problem || err}</span>}
        <Button type="submit" variant="primary" loading={busy} disabled={!!problem}>Save settings</Button>
      </div>
    </form>
  );
}

/* ---------------- Staff (owner) ---------------- */
const ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN'];
const ROLE_HELP = {
  OWNER: 'Full access, including staff accounts.', MANAGER: 'Menu, inventory, reports, settings, refunds and voids.',
  CASHIER: 'Billing, tables, orders and customers.', KITCHEN: 'Kitchen display only.',
};

function Staff() {
  const { user } = useAuth();
  const { data, error, loading, reload, refresh } = useAsync(() => api.get('/staff'), []);
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-3">Disabled accounts cannot sign in but stay on record against past orders.</p>
        <Button variant="primary" onClick={() => setEdit({})}><Plus size={15} />Add staff</Button>
      </div>
      <Card className="overflow-hidden">
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
          <Table><thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th right> </Th></tr></thead><tbody>
            {data.map((u) => (
              <tr key={u.id}><Td className="font-medium">{u.name}{u.id === user.id && <span className="ml-2 text-xs text-ink-3">(you)</span>}</Td><Td>{u.email}</Td><Td>{titleCase(u.role)}</Td>
                <Td>{u.active ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}</Td>
                <Td right><Button size="sm" variant="ghost" aria-label={`Edit ${u.name}`} onClick={() => setEdit(u)}><Pencil size={14} /></Button></Td></tr>))}
          </tbody></Table>)}
      </Card>
      {edit && <StaffForm staff={edit} self={edit.id === user.id} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
    </>
  );
}

function StaffForm({ staff, self, onClose, onSaved }) {
  const { toast } = useUi();
  const isNew = !staff.id;
  const [f, setF] = useState({ name: staff.name ?? '', email: staff.email ?? '', role: staff.role ?? 'CASHIER', active: staff.active ?? true, password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const pwBad = (isNew || f.password) && f.password.length < 8;
  const save = async () => {
    setBusy(true); setErr('');
    try {
      if (isNew) await api.post('/staff', { name: f.name, email: f.email, role: f.role, password: f.password });
      else await api.put(`/staff/${staff.id}`, { name: f.name, role: f.role, active: f.active, ...(f.password ? { password: f.password } : {}) });
      toast('Staff account saved'); onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={isNew ? 'Add staff member' : `Edit ${staff.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.name.trim() || (isNew && !f.email) || pwBad} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Full name"><Input autoFocus value={f.name} maxLength={80} onChange={set('name')} /></Field>
        <Field label="Email (used to sign in)"><Input type="email" value={f.email} disabled={!isNew} onChange={set('email')} /></Field>
        <Field label="Role" hint={ROLE_HELP[f.role]}><Select value={f.role} disabled={self} onChange={set('role')}>{ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select></Field>
        <Field label={isNew ? 'Password' : 'New password (leave blank to keep current)'} hint="At least 8 characters." error={pwBad && f.password ? 'Too short' : undefined}><Input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        {!isNew && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} disabled={self} onChange={set('active')} />Account active</label>}
        {self && <p className="text-xs text-ink-3">You cannot change your own role or disable your own account.</p>}
        {err && <div className="rounded-lg bg-rose-l px-3 py-2 text-sm text-rose">{err}</div>}
      </div>
    </Modal>
  );
}

/* ---------------- Audit log ---------------- */
function AuditLog() {
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(0);
  const LIMIT = 50;
  const { data, error, loading, reload } = useAsync(() => api.get(`/audit?${qs({ action: applied, limit: LIMIT, offset: page * LIMIT })}`), [applied, page]);
  return (
    <Card className="overflow-hidden">
      <form className="flex gap-2 border-b border-line p-3" onSubmit={(e) => { e.preventDefault(); setPage(0); setApplied(q.trim()); }}>
        <div className="relative max-w-sm flex-1"><Search size={15} className="absolute left-3 top-2.5 text-ink-3" /><Input className="pl-9" placeholder="Filter by action, e.g. REFUND or STAFF" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Button type="submit">Filter</Button>{applied && <Button type="button" variant="ghost" onClick={() => { setQ(''); setApplied(''); setPage(0); }}>Clear</Button>}
      </form>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.length ? <Empty title={page ? 'No more entries' : 'No audit entries found'} /> : (
        <Table><thead><tr><Th>Time</Th><Th>User</Th><Th>Action</Th><Th>Target</Th><Th>Reason</Th></tr></thead><tbody>
          {data.map((a) => <tr key={a.id}><Td>{fmtDateTime(a.createdAt)}</Td><Td>{a.user ?? 'System'}</Td><Td><span className="font-mono text-xs">{a.action}</span></Td><Td>{a.entity ? `${a.entity} #${a.entityId ?? ''}` : '—'}</Td><Td>{a.reason ?? '—'}</Td></tr>)}</tbody></Table>)}
      <div className="flex items-center justify-between border-t border-line p-3">
        <Button size="sm" disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>Newer</Button>
        <span className="text-xs text-ink-3">Page {page + 1}</span>
        <Button size="sm" disabled={loading || !data || data.length < LIMIT} onClick={() => setPage(page + 1)}>Older</Button>
      </div>
    </Card>
  );
}
