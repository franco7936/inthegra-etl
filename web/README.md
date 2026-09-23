# Inthegra Reports Web

Aplicacion dinamica del portal de reportes.

Esta app usa Next.js y consulta Turso desde API routes del lado servidor. El navegador nunca recibe `TURSO_TOKEN`.

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
