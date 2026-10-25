import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, homeFor } from './auth.jsx';
import Layout from './Layout.jsx';
import { Spinner } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Pos from './pages/Pos.jsx';
import Tables from './pages/Tables.jsx';
import Orders from './pages/Orders.jsx';
import Kitchen from './pages/Kitchen.jsx';
import MenuManagement from './pages/MenuManagement.jsx';
import Inventory from './pages/Inventory.jsx';
import Customers from './pages/Customers.jsx';
import Reports from './pages/Reports.jsx';
import SettingsPage from './pages/Settings.jsx';

function Guard({ page, children }) {
  const { can, user } = useAuth();
  return can(page) ? children : <Navigate to={homeFor(user.role)} replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  const g = (page, el) => <Guard page={page}>{el}</Guard>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to={homeFor(user.role)} replace />} />
        <Route path="/dashboard" element={g('dashboard', <Dashboard />)} />
        <Route path="/pos" element={g('pos', <Pos />)} />
        <Route path="/tables" element={g('tables', <Tables />)} />
        <Route path="/orders" element={g('orders', <Orders />)} />
        <Route path="/kitchen" element={g('kitchen', <Kitchen />)} />
        <Route path="/menu" element={g('menu', <MenuManagement />)} />
        <Route path="/inventory" element={g('inventory', <Inventory />)} />
        <Route path="/customers" element={g('customers', <Customers />)} />
        <Route path="/reports" element={g('reports', <Reports />)} />
        <Route path="/settings" element={g('settings', <SettingsPage />)} />
        <Route path="*" element={<Navigate to={homeFor(user.role)} replace />} />
      </Route>
    </Routes>
  );
}
