'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

function monthRange(monthValue) {
  const [year, month] = String(monthValue || '').split('-').map(Number);
  const safeDate = year && month ? new Date(Date.UTC(year, month - 1, 1)) : new Date();
  const safeYear = safeDate.getUTCFullYear();
  const safeMonth = safeDate.getUTCMonth() + 1;
  const monthKey = `${safeYear}-${String(safeMonth).padStart(2, '0')}`;
  const from = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(safeYear, safeMonth, 0)).getUTCDate();
  const to = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
  return { month: monthKey, from, to };
}

function currentMonthRange() {
  const now = new Date();
  return monthRange(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
}

function monthTitle(monthValue) {
  const { from } = monthRange(monthValue);
  const date = new Date(`${from}T00:00:00Z`);
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function reportFilters(filters) {
  return { from: filters.from, to: filters.to };
}

function TrendIcon({ trend }) {
  if (trend === 'up') return <span className="trend up">▲</span>;
  if (trend === 'down') return <span className="trend down">▼</span>;
  return null;
}

function IndicatorCard({ card }) {
  return (
    <article className={`indicatorCard tone-${card.tone || 'default'}`}>
      <div>
        <span className="indicatorTitle">{card.title}</span>
        <strong>{card.value || '-'}</strong>
        {card.detail && <small>{card.detail}</small>}
      </div>
      <TrendIcon trend={card.trend} />
    </article>
  );
}

function IndicatorSection({ section }) {
  return (
    <section className="indicatorSection">
      <h2>{section.title}</h2>
      <div className="indicatorGrid">
        {section.cards.map((card) => <IndicatorCard key={card.id} card={card} />)}
      </div>
    </section>
  );
}

export default function EntregaCalidadPage() {
  const initial = currentMonthRange();
  const [filters, setFilters] = useState({ month: initial.month, from: initial.from, to: initial.to });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams(reportFilters(nextFilters));
    try {
      const response = await fetch(`/api/reportes/entrega-calidad?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar el reporte');
      setData(payload);
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const modelPending = data && data.modelReady === false;

  function handleMonthChange(value) {
    setFilters({ ...filters, ...monthRange(value) });
  }

  return (
    <main className="shell reportShell deliveryShell">
      <nav className="topbar">
        <Link className="brand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span><strong>Inthegra Reports</strong><small>Indicadores de servicio</small></span>
        </Link>
        <Link className="navLink" href="/">Inicio</Link>
      </nav>

      <section className="deliveryHeader">
        <div>
          <h1>Indicadores de Entrega y Calidad de Servicio</h1>
          <p>Indicadores operativos de entrega, uso de horas, soporte, roadmap y retrabajo.</p>
        </div>
        <div className="deliveryMeta">
          <span>{data?.collaborators ? `Indicadores en base a ${data.collaborators} colaboradores` : 'Base pendiente'}</span>
          <span className={error || modelPending ? 'status error' : 'status'}>{loading ? 'Consultando Turso' : error ? 'Error de datos' : modelPending ? 'Modelo pendiente' : 'Datos actualizados'}</span>
        </div>
      </section>

      <section className="deliveryFilters">
        <label>Mes<input type="month" value={filters.month} onChange={(event) => handleMonthChange(event.target.value)} /></label>
        <button className="primaryButton compact" onClick={() => loadData(filters)}>Aplicar</button>
      </section>

      {error && <div className="errorBox">{error}</div>}
      {modelPending && <div className="errorBox">{data.setupMessage}</div>}
      {data?.demo && <div className="warningBox">Vista previa con datos de referencia del mockup. Los valores reales se activan cuando exista la vista SQL.</div>}

      {loading ? (
        <section className="indicatorSection"><div className="emptyState">Cargando indicadores...</div></section>
      ) : (
        <div className="indicatorBoard">
          <p className="periodCaption">Periodo: {monthTitle(filters.month)}</p>
          {(data?.sections || []).map((section) => <IndicatorSection key={section.id} section={section} />)}
        </div>
      )}
    </main>
  );
}
