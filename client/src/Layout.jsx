import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, ReceiptText, Grid2x2, ClipboardList, ChefHat, BookOpen, Boxes, Users, BarChart3, Settings, LogOut, Menu as MenuIcon, X, Coffee } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { cx, titleCase } from './ui.jsx';

const NAV = [
  ['dashboard', '/dashboard', 'Dashboard', LayoutDashboard], ['pos', '/pos', 'Billing', ReceiptText], ['tables', '/tables', 'Tables', Grid2x2],
  ['orders', '/orders', 'Orders', ClipboardList], ['kitchen', '/kitchen', 'Kitchen', ChefHat], ['menu', '/menu', 'Menu', BookOpen],
  ['inventory', '/inventory', 'Inventory', Boxes], ['customers', '/customers', 'Customers', Users], ['reports', '/reports', 'Reports', BarChart3], ['settings', '/settings', 'Settings', Settings],
];

export default function Layout() {
  const { user, logout, can, settings } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const items = NAV.filter(([k]) => can(k));
  const current = items.find(([, to]) => loc.pathname.startsWith(to));
  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 p-2.5">
      {items.map(([k, to, label, Icon]) => (
        <NavLink key={k} to={to} onClick={() => setOpen(false)}
          className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150', isActive ? 'bg-terra text-white shadow-sm shadow-terra/30' : 'text-cream/70 hover:bg-white/10 hover:text-white')}>
          <Icon size={18} />{label}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 flex-col bg-gradient-to-b from-ink to-[#1f1d1b] text-cream lg:flex">
        <Brand />{nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-ink/50 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-gradient-to-b from-ink to-[#1f1d1b] text-cream shadow-2xl"><div className="flex items-center justify-between pr-3"><Brand /><button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-lg p-1.5 hover:bg-white/10"><X size={20} /></button></div>{nav}</aside></div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-white px-4 shadow-[0_1px_3px_0_rgba(0,0,0,0.04)]">
          <button className="rounded-lg p-1.5 transition-colors hover:bg-cream-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><MenuIcon size={20} /></button>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{current?.[2] ?? 'CafeFlow POS'}</div><div className="hidden truncate text-xs text-ink-3 sm:block">{settings?.cafeName}</div></div>
          <div className="text-right leading-tight"><div className="text-sm font-medium">{user.name}</div><div className="text-xs text-ink-3">{titleCase(user.role)}</div></div>
          <button onClick={logout} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-cream-2 hover:text-ink" title="Sign out"><LogOut size={15} /><span className="hidden sm:inline">Sign out</span></button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto"><Outlet /></main>
      </div>
    </div>
  );
}
function Brand() {
  return <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-terra shadow-sm shadow-terra/30"><Coffee size={19} className="text-white" /></span><span className="text-base font-bold tracking-tight">CafeFlow <span className="font-normal text-cream/50">POS</span></span></div>;
}
