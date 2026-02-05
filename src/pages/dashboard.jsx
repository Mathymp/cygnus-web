import React from 'react';
import { TrendingUp, DollarSign, Package, AlertCircle } from 'lucide-react';

const Dashboard = () => {
  return (
    <div className="animate-fade-in">
      {/* 1. KPIs / Stats Cards */}
      <div className="grid-dashboard">
        {/* Card 1 */}
        <div className="card">
          <div className="flex-between">
            <div>
              <p className="text-muted">Ventas de Hoy</p>
              <h3 className="text-big">$125.400</h3>
            </div>
            <div className="btn-icon" style={{background: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6'}}>
              <DollarSign />
            </div>
          </div>
          <p className="text-success flex-row" style={{marginTop: '10px', fontSize: '0.85rem'}}>
            <TrendingUp size={16} /> +15% vs ayer
          </p>
        </div>

        {/* Card 2 */}
        <div className="card">
          <div className="flex-between">
            <div>
              <p className="text-muted">Pedidos Totales</p>
              <h3 className="text-big">34</h3>
            </div>
            <div className="btn-icon" style={{background: 'rgba(16, 185, 129, 0.2)', color: '#10b981'}}>
              <Package />
            </div>
          </div>
          <p className="text-muted" style={{marginTop: '10px', fontSize: '0.85rem'}}>
            4 pendientes de envío
          </p>
        </div>

        {/* Card 3 */}
        <div className="card">
          <div className="flex-between">
            <div>
              <p className="text-muted">Stock Crítico</p>
              <h3 className="text-big">8</h3>
            </div>
            <div className="btn-icon" style={{background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444'}}>
              <AlertCircle />
            </div>
          </div>
          <p className="text-danger" style={{marginTop: '10px', fontSize: '0.85rem'}}>
            Requiere atención
          </p>
        </div>
      </div>

      {/* 2. Sección Principal Dividida */}
      <div className="grid-2-col">
        
        {/* Tabla de Últimas Ventas */}
        <div className="card">
          <div className="flex-between" style={{marginBottom: '1rem'}}>
            <h3 className="text-h3">Últimas Transacciones</h3>
            <button className="btn btn-primary" style={{fontSize: '0.8rem'}}>Ver Todo</button>
          </div>
          
          <table className="table-container">
            <thead>
              <tr>
                <th>ID</th>
                <th>Cliente</th>
                <th>Monto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-muted">#2045</td>
                <td>Juan Pérez</td>
                <td>$12.990</td>
                <td><span className="status-badge status-ok">Completado</span></td>
              </tr>
              <tr>
                <td className="text-muted">#2044</td>
                <td>Maria Gomez</td>
                <td>$45.500</td>
                <td><span className="status-badge status-low">Pendiente</span></td>
              </tr>
              <tr>
                <td className="text-muted">#2043</td>
                <td>Pedro Lira</td>
                <td>$8.990</td>
                <td><span className="status-badge status-ok">Completado</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Panel Lateral de Resumen / Accesos */}
        <div className="flex-col">
          <div className="card" style={{background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'}}>
            <h3 className="text-h3">Acciones Rápidas</h3>
            <div className="flex-col" style={{marginTop: '1rem'}}>
              <button className="btn" style={{background: 'rgba(255,255,255,0.1)', color: 'white', textAlign: 'left'}}>+ Nueva Venta</button>
              <button className="btn" style={{background: 'rgba(255,255,255,0.1)', color: 'white', textAlign: 'left'}}>+ Ingresar Stock</button>
            </div>
          </div>
          
          <div className="card">
            <h3 className="text-h3">Estado del Sistema</h3>
            <div className="flex-between" style={{marginTop: '1rem'}}>
              <span className="text-muted">Servidor</span>
              <span className="text-success">En línea ●</span>
            </div>
            <div className="flex-between" style={{marginTop: '0.5rem'}}>
              <span className="text-muted">Base de Datos</span>
              <span className="text-success">Conectada ●</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Dashboard;