import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coffee } from 'lucide-react';
import { useAuth, homeFor } from '../auth.jsx';
import { Button, Field, Input } from '../ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { const u = await login(email.trim(), password); nav(homeFor(u.role), { replace: true }); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(192,96,60,0.06),transparent_50%),radial-gradient(circle_at_70%_80%,rgba(91,123,90,0.06),transparent_50%)] p-4">
      <div className="grid w-full max-w-3xl overflow-hidden rounded-2xl border border-line bg-white shadow-xl shadow-black/[0.06] md:grid-cols-2">
        <div className="hidden flex-col justify-between bg-gradient-to-br from-ink to-[#1f1d1b] p-8 text-cream md:flex">
          <div className="flex items-center gap-2.5"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-terra shadow-sm shadow-terra/30"><Coffee size={21} className="text-white" /></span><span className="text-lg font-bold tracking-tight">CafeFlow POS</span></div>
          <div><p className="text-2xl font-bold leading-snug tracking-tight">Billing, kitchen and stock in one counter.</p><p className="mt-3 text-sm text-cream/60">Dine-in, takeaway and delivery — from order to kitchen ticket to receipt.</p></div>
          <p className="text-xs text-cream/40">Demo data only. UPI and card payments are recorded, not processed.</p>
        </div>
        <form onSubmit={submit} className="flex flex-col justify-center p-6 sm:p-8">
          <h1 className="text-xl font-bold tracking-tight">Sign in</h1><p className="mb-6 mt-1 text-sm text-ink-3">Use your staff account.</p>
          <div className="space-y-4">
            <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@cafe.com" /></Field>
            <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            {error && <div role="alert" className="rounded-lg bg-rose-l px-3 py-2 text-sm text-rose">{error}</div>}
            <Button variant="primary" type="submit" loading={busy} className="w-full">Sign in</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
