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

## Modelo vigente

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
| `VW_INVERSION_ESTRATEGICA` | Horas destinadas agrupadas por proyecto y epica. |
| `VW_QA_METRICAS_MINIMAS` | Tablero minimo de metricas QA. |

## Web dinamica

La app esta en `web/`.

Endpoints:

| Endpoint | Uso |
| --- | --- |
| `/api/health` | Valida conexion de la web con Turso. |
| `/api/reportes/horas` | Reporte de horas. |
| `/api/reportes/entrega-calidad` | Entrega y calidad de servicio. |
| `/api/reportes/inversion-estrategica` | Inversion estrategica por proyecto y epica. |
| `/api/reportes/calidad-performance` | Tablero minimo de metricas QA. |

Pantallas:

| Ruta | Uso |
| --- | --- |
| `/` | Home del portal. |
| `/reportes/horas` | Reporte dinamico de horas. |
| `/reportes/entrega-calidad` | Indicadores de Entrega y Calidad de Servicio. |
| `/reportes/inversion-estrategica` | Inversiones Estrategicas por proyecto y epica. |
| `/reportes/calidad-performance` | Tablero minimo de metricas QA. |

## Contrato esperado para `VW_QA_METRICAS_MINIMAS`

Este reporte mide pocas metricas QA, pero utiles para decidir, priorizar mejoras y reducir riesgo en releases.

Mientras la vista SQL no exista, usa datos de referencia y muestra estado `Modelo pendiente`.

Columnas esperadas:

| Columna | Uso |
| --- | --- |
| `fecha_desde` | Inicio del periodo. |
| `fecha_hasta` | Fin del periodo. |
| `orden` | Orden de visualizacion. |
| `metric_id` | ID tecnico de la metrica. |
| `metrica` | Nombre visible de la metrica. |
| `valor_actual` | Valor numerico calculado. |
| `valor_formateado` | Valor visible. Ejemplo: `0,0%`. |
| `objetivo` | Objetivo visible. Ejemplo: `>= 90%`. |
| `objetivo_valor` | Valor numerico del objetivo. |
| `sentido` | `mayor_mejor` o `menor_mejor`. |
| `estado` | `OK` o `Revisar`. |
| `lectura` | Lectura rapida del resultado. |
| `fuente` | Fuente conceptual del dato. |
| `tipo` | `porcentaje`, `horas`, `dias` o `numero`. |

Metricas minimas contempladas:

- Bugs en produccion / Escape Rate
- MTTR bugs criticos P0/P1
- Cobertura de regresion
- Smoke test por deploy
- Criterios de aceptacion definidos
- US con Test Cases antes del Sprint
- Tasa de reapertura de bugs
- Tiempo ciclo Dev a QA a Done

## Contratos pendientes

Tambien estan pendientes de definicion/creacion estas vistas:

- `VW_INDICADORES_ENTREGA_CALIDAD`
- `VW_INVERSION_ESTRATEGICA`

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

## ETL en GitHub Actions

Workflow principal:

```text
.github/workflows/etl_semanal.yml
```

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

## Desarrollo local

ETL:

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python etl.py --solo-conexion
python etl.py --recrear-modelo --full --sin-jsm
python etl.py --sin-jsm
```

Web:

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

## Proximos pasos

1. Esperar que termine la corrida full del ETL.
2. Verificar que existan las vistas `VW_REPORTE_HORAS_*` en Turso.
3. Definir y crear las vistas SQL pendientes en `etl.py`.
4. Probar todos los reportes desde Vercel.
