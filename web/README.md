# Inthegra Reports Web

Aplicacion dinamica del portal de reportes.

Esta app usa Next.js y consulta Turso desde API routes del lado servidor. El navegador nunca recibe `TURSO_TOKEN`.

## Frontend y diseño

El frontend esta migrando a un sistema visual responsive por etapas.

Stack base:

- Tailwind CSS para layout responsive y utilidades de diseno.
- Lucide React para iconografia consistente.
- Recharts para graficos de reportes.
- TanStack Table para evolucionar las grillas de datos.
- Componentes propios reutilizables sobre la identidad visual de Inthegra, con una base tipo `shadcn/ui` adaptada al proyecto.

La home ya usa la nueva base de componentes (`PageSection`, `Surface`, `ReportCard`) para organizar reportes por categoria. `Reporte de horas`, `Novedades laborales`, `Usuarios` y `Roles` usan la misma linea visual: hero moderno, filtros/formularios en panel, KPIs con iconos, paneles de datos consistentes y tablas compactas. El login tambien fue migrado a una pantalla dividida moderna con identidad Inthegra. En pantallas chicas mantienen scroll horizontal controlado cuando corresponde.

## Deploy gratis en Vercel

Al importar el repositorio en Vercel usar:

```text
Root Directory: web
Framework Preset: Next.js
Build Command: npm run build
Install Command: npm install
Output Directory: .next
```

Variables de entorno requeridas en Vercel:

```text
TURSO_URL
TURSO_TOKEN
```

## Desarrollo local

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

Luego abrir:

```text
http://localhost:3000
```

Healthcheck de conexion a Turso:

```text
/api/health
```

API del reporte de horas:

```text
/api/reportes/horas?from=2026-09-01&to=2026-09-30
```

## Datos esperados

La app espera que el ETL haya creado estas vistas en Turso:

- `VW_REPORTE_HORAS_DETALLE`
- `VW_REPORTE_HORAS_PERSONA_TIPO`
- `VW_REPORTE_HORAS_EQUIPO_TIPO`
