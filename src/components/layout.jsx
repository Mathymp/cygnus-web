import React from 'react';
import Sidebar from './Sidebar';

const Layout = ({ children, activePage, setActivePage }) => {
  return (
    <div className="app-container">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />
      <main className="main-content">
        {/* Header Superior opcional si quieres buscador o usuario */}
        <header className="flex-between" style={{ padding: '0 2rem', height: 'var(--header-height)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <h2 className="text-h2" style={{margin:0, textTransform: 'capitalize'}}>{activePage}</h2>
          <div className="flex-row">
            <span className="text-muted">Admin: Mathy</span>
            <div className="btn-icon">M</div>
          </div>
        </header>

        {/* Contenido scrolleable */}
        <div className="content-scrollable">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;