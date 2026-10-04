import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import logo from '../assets/logo.png';

const ROLE_LABELS = {
  beheerder: 'Beheerder',
  manager: 'Manager',
  controleur: 'Controleur',
  monteur: 'Monteur',
  leerling: 'Leerling',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { to: '/', label: 'Dashboard', end: true },
    { to: '/woningen', label: 'Woningen' },
    { to: '/opnames', label: 'Opnames' },
    { to: '/materiaal', label: 'Materiaal' },
    ...(['beheerder', 'manager'].includes(user?.role) ? [{ to: '/managementrapportage', label: 'Managementrapportage' }] : []),
    ...(['beheerder', 'manager', 'controleur'].includes(user?.role) ? [{ to: '/verbeterplan', label: 'Verbeterplan' }] : []),
    ...(['beheerder', 'manager'].includes(user?.role) ? [{ to: '/werkzaamhedencatalogus', label: 'Catalogus' }] : []),
    ...(user?.role === 'beheerder' ? [
      { to: '/gebruikers', label: 'Gebruikers' },
      { to: '/checklists', label: 'Checklists' },
      { to: '/audittrail', label: 'Audittrail' },
    ] : []),
  ];

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="hamburger" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
          &#9776;
        </button>
        <div className="app-title">
          <img src={logo} alt="Arrobio Techniek" className="app-logo" />
          <span className="app-title-sub">KWALITEITSPORTAAL</span>
        </div>
        <div className="app-user">
          <Link to="/account" className="btn-link">{user?.name} <span className="role-pill">{ROLE_LABELS[user?.role]}</span></Link>
          <button className="btn-link" onClick={handleLogout}>Uitloggen</button>
        </div>
      </header>
      <div className="app-body">
        <nav className={`app-nav ${menuOpen ? 'open' : ''}`}>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
