import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Properties from './pages/Properties.jsx';
import PropertyDetail from './pages/PropertyDetail.jsx';
import Users from './pages/Users.jsx';
import ChecklistAdmin from './pages/ChecklistAdmin.jsx';
import AuditTrail from './pages/AuditTrail.jsx';
import ManagementReport from './pages/ManagementReport.jsx';
import ImprovementPlan from './pages/ImprovementPlan.jsx';
import Account from './pages/Account.jsx';
import Materials from './pages/Materials.jsx';
import CatalogAdmin from './pages/CatalogAdmin.jsx';
import Opnames from './pages/Opnames.jsx';
import OpnameDetail from './pages/OpnameDetail.jsx';

function ProtectedRoute({ children, roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="woningen" element={<Properties />} />
        <Route path="woningen/:id" element={<PropertyDetail />} />
        <Route path="opnames" element={<Opnames />} />
        <Route path="opnames/:id" element={<OpnameDetail />} />
        <Route path="materiaal" element={<Materials />} />
        <Route path="gebruikers" element={<ProtectedRoute roles={['beheerder']}><Users /></ProtectedRoute>} />
        <Route path="checklists" element={<ProtectedRoute roles={['beheerder']}><ChecklistAdmin /></ProtectedRoute>} />
        <Route path="werkzaamhedencatalogus" element={<ProtectedRoute roles={['beheerder', 'manager']}><CatalogAdmin /></ProtectedRoute>} />
        <Route path="audittrail" element={<ProtectedRoute roles={['beheerder']}><AuditTrail /></ProtectedRoute>} />
        <Route path="managementrapportage" element={<ProtectedRoute roles={['beheerder', 'manager']}><ManagementReport /></ProtectedRoute>} />
        <Route path="verbeterplan" element={<ProtectedRoute roles={['beheerder', 'manager', 'controleur']}><ImprovementPlan /></ProtectedRoute>} />
        <Route path="account" element={<Account />} />
      </Route>
    </Routes>
  );
}
