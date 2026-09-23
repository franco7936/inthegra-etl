# Inthegra ETL

Repositorio del ETL y portal de reportes operativos de Inthegra.

El proyecto centraliza datos de Jira y ActivityTimeline en Turso, los asocia con IDs internos propios y los expone en una web dinamica.

## Arquitectura vigente

```text
Jira + ActivityTimeline
        |
        v
GitHub Actions -> etl.py
        |
        v
Turso
        |
        v
Vistas SQL de reporte
        |
        v
Vercel / Next.js / web/
```

- GitHub Actions corre el ETL.
- Turso guarda la base de datos.
- Next.js en Vercel muestra la web dinamica.
- La web consulta Turso desde API routes del lado servidor, sin exponer `TURSO_TOKEN` en el navegador.
- `docs/` queda como version estatica anterior publicada por GitHub Pages, pero el camino principal pasa a ser `web/`.

## Estructura del repositorio

```text
.github/workflows/etl_semanal.yml   Automatizacion principal del ETL
.github/workflows/pages.yml         Publicacion estatica anterior desde docs/
docs/                               Portal estatico anterior
web/                                Portal dinamico Next.js para Vercel
etl.py                              Proceso principal Jira + ActivityTimeline -> Turso
turso_conn.py                       Adaptador HTTP a Turso usado por Python
requirements.txt                    Dependencias Python
README.md                           Documentacion del proyecto
```

## Modelo vigente

El modelo vigente es el modelo v2.

Tablas principales:

| Tabla | Uso |
| --- | --- |
| `map_equipo_proyecto` | Asocia equipos de ActivityTimeline con proyectos de Jira usando `project_id`. |
| `map_personas` | Asocia usuarios de ActivityTimeline con usuarios de Jira usando `person_id`. |
| `at_workload` | Tabla consolidada de ActivityTimeline con eventos, tareas y tiempos. |
| `rpt_issues` | Issues de Jira usando `project_id`. |
| `rpt_worklogs` | Worklogs de Jira usando `person_id` y `project_id`. |
| `rpt_sprints` | Sprints de Jira asociados a `project_id`. |
| `rpt_epicas` | Epicas de Jira asociadas a `project_id`. |
| `etl_log` | Log general del ETL. |

## Vistas usadas por la web

Regla del proyecto: todo dato que se exponga al front debe salir de una vista SQL.

| Vista | Uso |
| --- | --- |
| `VW_REPORTE_HORAS_DETALLE` | Detalle base con persona, proyecto, tipo de evento y tiempo. |
| `VW_REPORTE_HORAS_PERSONA_TIPO` | Agrupacion por fecha, persona, proyecto y tipo de actividad. |
| `VW_REPORTE_HORAS_EQUIPO_TIPO` | Agrupacion por fecha, proyecto/equipo y tipo de actividad. |
| `VW_INDICADORES_ENTREGA_CALIDAD` | Indicadores ejecutivos de entrega, horas, soporte, SLA, roadmap y retrabajo. |

## Web dinamica

La app esta en:

```text
web/
```

Tecnologia:

- Next.js
- API routes server-side
- Turso con `@libsql/client`
- Deploy recomendado: Vercel free tier

Endpoints iniciales:

| Endpoint | Uso |
| --- | --- |
| `/api/health` | Valida conexion de la web con Turso. |
| `/api/reportes/horas` | Devuelve datos del reporte de horas filtrados por fecha, proyecto y tipo de actividad. |
| `/api/reportes/entrega-calidad` | Devuelve indicadores ejecutivos de entrega y calidad de servicio. |

Pantallas iniciales:

| Ruta | Uso |
| --- | --- |
| `/` | Home del portal. |
| `/reportes/horas` | Reporte dinamico de horas. |
| `/reportes/entrega-calidad` | Indicadores de Entrega y Calidad de Servicio. |

## Contrato esperado para `VW_INDICADORES_ENTREGA_CALIDAD`

La nueva pantalla ya existe. Mientras la vista SQL no exista, usa datos de referencia del mockup y muestra estado `Modelo pendiente`.

Columnas esperadas para la vista:

| Columna | Uso |
| --- | --- |
| `fecha_desde` | Inicio del periodo del indicador. |
| `fecha_hasta` | Fin del periodo del indicador. |
| `colaboradores` | Cantidad de colaboradores base del calculo. |
| `seccion_id` | ID de seccion: por ejemplo `generales`, `saas`, `custom`. |
| `seccion_titulo` | Titulo visible de la seccion. |
| `indicador_id` | ID tecnico del indicador. |
| `titulo` | Titulo visible de la tarjeta. |
| `valor` | Valor numerico base. |
| `unidad` | Unidad: `hrs`, `%`, etc. |
| `valor_formateado` | Valor final para mostrar. Ejemplo: `3180 hrs`. |
| `detalle` | Texto secundario opcional. |
| `tendencia` | `up`, `down` o `neutral`. |
| `estado` | `default`, `success`, `soft` o `danger`. |
| `orden_seccion` | Orden de la seccion. |
| `orden_indicador` | Orden de la tarjeta dentro de la seccion. |

## Deploy gratis en Vercel

Al importar el repositorio en Vercel configurar:

```text
Root Directory: web
Framework Preset: Next.js
Build Command: npm run build
Install Command: npm install
Output Directory: .next
```

Variables de entorno en Vercel:

```text
TURSO_URL
TURSO_TOKEN
```

Estas variables son privadas en Vercel. No se deben poner en el codigo ni en el navegador.

## ETL en GitHub Actions

Workflow principal:

```text
.github/workflows/etl_semanal.yml
```

Parametros manuales:

| Parametro | Valores | Uso recomendado |
| --- | --- | --- |
| `modo` | `incremental` o `full` | `full` para reconstruir un periodo amplio; `incremental` para corridas normales. |
| `recrear_modelo` | `true` o `false` | Usar `true` solo una vez para borrar el modelo viejo y crear el modelo v2 limpio. |
| `sin_jsm` | `true` o `false` | En modelo v2 se conserva por compatibilidad; JSM no crea tablas por ahora. |

Primera corrida recomendada del modelo v2:

```text
modo = full
recrear_modelo = true
sin_jsm = true
```

Corridas normales:

```text
modo = incremental
recrear_modelo = false
sin_jsm = true
```

## Desarrollo local del ETL

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python etl.py --solo-conexion
python etl.py --recrear-modelo --full --sin-jsm
python etl.py --sin-jsm
```

Variables requeridas para el ETL:

```text
JIRA_BASE_URL
JIRA_EMAIL
JIRA_API_TOKEN
JIRA_PROJECTS
AT_BASE_URL
AT_TOKEN
TURSO_URL
TURSO_TOKEN
QMETRY_PROJECT_KEY
```

## Desarrollo local de la web

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

Variables requeridas para la web:

```text
TURSO_URL
TURSO_TOKEN
```

## Tablas eliminadas del modelo

Estas tablas ya no se crean en el modelo v2:

- `at_capacity`
- `at_eventos`
- `at_equipos`
- `at_usuarios`
- `rpt_proyectos`
- `rpt_comentarios`
- `rpt_componentes`
- `rpt_issue_links`
- `rpt_jsm_slas`
- `rpt_jsm_tickets`
- `rpt_versiones`
- `rpt_changelog`
- `rpt_etl_log`
- `map_at_equipo_proyecto`
- `map_persona_fuentes`

## Proximos pasos

1. Esperar que termine la corrida full del ETL.
2. Verificar que existan las vistas `VW_REPORTE_HORAS_*` en Turso.
3. Definir la logica de calculo para `VW_INDICADORES_ENTREGA_CALIDAD`.
4. Crear la vista SQL de indicadores en `etl.py`.
5. Probar `/api/health`, `/reportes/horas` y `/reportes/entrega-calidad`.
