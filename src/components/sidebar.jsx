import React from 'react';
import { LayoutDashboard, ShoppingCart, Package, Users, Settings, LogOut } from 'lucide-react';

const Sidebar = ({ activePage, setActivePage }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard /> },
    { id: 'sales', label: 'Ventas', icon: <ShoppingCart /> },
    { id: 'inventory', label: 'Inventario', icon: <Package /> },
    { id: 'clients', label: 'Clientes', icon: <Users /> },
  ];

  return (
    <aside className="sidebar">
      <div className="logo-area">
        <Package size={28} />
        KENOS OS
      </div>

      <nav className="flex-col" style={{ flex: 1 }}>
        {menuItems.map((item) => (
          <div
            key={item.id}
            className={`nav-link ${activePage === item.id ? 'active' : ''}`}
            onClick={() => setActivePage(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </div>
        ))}
      </nav>

      <div className="flex-col">
        <div className="nav-link">
          <Settings />
          <span>Configuración</span>
        </div>
        <div className="nav-link" style={{ color: 'var(--danger)' }}>
          <LogOut />
          <span>Salir</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;