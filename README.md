# Inthegra ETL

Repositorio del ETL y portal de reportes operativos de Inthegra.

El proyecto centraliza datos de Jira y ActivityTimeline en Turso, los asocia con IDs internos propios y los expone en una web dinamica.

## Arquitectura vigente

```text
Jira + ActivityTimeline
        |
        v
GitHub Actions -> etl_runner.py -> etl.py
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

- GitHub Actions corre el ETL usando `etl_runner.py`.
- `etl.py` sigue siendo el proceso principal del ETL.
- `etl_runner.py` aplica protecciones operativas antes de ejecutar `etl.py`: reintenta cortes transitorios de Jira, reduce paginas de Jira, corta paginas repetidas de ActivityTimeline, reduce ruido de logs HTTP y aplica vistas complementarias versionadas.
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
| `VW_NOVEDADES_LABORALES` | Day off, feriados y horas extras por persona y por equipo. |
| `VW_STATUS_SEMANAL_LIDERES` | Reporte semanal de status informado por lideres. |
| `VW_INDICADORES_ENTREGA_CALIDAD` | Indicadores ejecutivos de entrega, horas, soporte, SLA, roadmap y retrabajo. |
| `VW_INVERSION_ESTRATEGICA` | Horas destinadas agrupadas por proyecto y epica. |
| `VW_QA_METRICAS_MINIMAS` | Tablero minimo de metricas QA. |

Definiciones SQL versionadas:

| Archivo | Uso |
| --- | --- |
| `sql/vw_novedades_laborales.sql` | Definicion ejecutable de `VW_NOVEDADES_LABORALES`. `etl_runner.py` la aplica al refrescar vistas. |

## Web dinamica

La app esta en `web/`.

Endpoints:

| Endpoint | Uso |
| --- | --- |
| `/api/health` | Valida conexion de la web con Turso. |
| `/api/reportes/horas` | Reporte de horas. |
| `/api/reportes/novedades-laborales` | Novedades laborales. |
| `/api/reportes/status-semanal` | Status semanal de lideres. |
| `/api/reportes/entrega-calidad` | Entrega y calidad de servicio. |
| `/api/reportes/inversion-estrategica` | Inversion estrategica por proyecto y epica. |
| `/api/reportes/calidad-performance` | Tablero minimo de metricas QA. |

Pantallas:

| Ruta | Uso |
| --- | --- |
| `/` | Home del portal. |
| `/reportes/horas` | Reporte dinamico de horas. |
| `/reportes/novedades-laborales` | Day off, feriados y horas extras por persona y equipo. |
| `/reportes/status-semanal` | Reporte semanal de lideres con avances, riesgos, bloqueos y proximos pasos. |
| `/reportes/entrega-calidad` | Indicadores de Entrega y Calidad de Servicio. |
| `/reportes/inversion-estrategica` | Inversiones Estrategicas por proyecto y epica. |
| `/reportes/calidad-performance` | Tablero minimo de metricas QA. |

## Contrato esperado para `VW_STATUS_SEMANAL_LIDERES`

Este reporte replica en la web el reporte semanal que hoy se completa en Excel por los lideres. Mientras la vista SQL no exista, usa datos de referencia y muestra estado `Modelo pendiente`.

Columnas esperadas:

| Columna | Uso |
| --- | --- |
| `semana` | Fecha de inicio o corte semanal. |
| `equipo` | Equipo o vertical reportada. |
| `lider` | Lider responsable del status. |
| `proyecto` | Proyecto, iniciativa o frente de trabajo. |
| `estado` | Estado visible del item. |
| `salud` | Semaforo tecnico: `verde`, `amarillo`, `rojo` o `gris`. |
| `avance_pct` | Avance porcentual del item. |
| `prioridad` | Prioridad del seguimiento. |
| `resumen` | Lectura ejecutiva del item. |
| `avances` | Avances de la semana. |
| `riesgos` | Riesgos identificados. |
| `bloqueos` | Bloqueos o dependencias. |
| `proximos_pasos` | Acciones siguientes. |
| `fecha_actualizacion` | Ultima fecha de actualizacion del registro. |

La pantalla permite filtrar por semana y equipo. Presenta resumen general, semaforo semanal, lectura ejecutiva y detalle por item.

## Contrato esperado para `VW_NOVEDADES_LABORALES`

Este reporte toma datos de ActivityTimeline desde `at_workload` y muestra solamente novedades laborales: `day_off`, `holiday` y horas extras.

Mientras la vista SQL no exista, usa datos de referencia y muestra estado `Modelo pendiente`.

Columnas esperadas:

| Columna | Uso |
| --- | --- |
| `fecha` | Fecha de la novedad. Debe permitir filtrar por periodo. |
| `person_id` | Persona normalizada desde `map_personas`. |
| `persona` | Nombre visible de la persona. |
| `project_id` | Proyecto/equipo normalizado desde `map_equipo_proyecto`. |
| `equipo` | Nombre visible del equipo. |
| `event_type` | Tipo tecnico: `day_off`, `holiday` u `overtime`. |
| `event_label` | Nombre visible: `Day off`, `Holiday`, `Horas extras`. |
| `horas` | Horas asociadas a la novedad. |
| `registros` | Cantidad de registros agrupados. |

La pantalla permite filtrar por fecha, equipo y tipo de novedad. Presenta resumen general, distribucion por tipo, agrupacion por persona, agrupacion por equipo y detalle.

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

- `VW_STATUS_SEMANAL_LIDERES`
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

El workflow ejecuta:

```bash
python etl_runner.py [args]
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

Variables operativas del workflow:

| Variable | Uso |
| --- | --- |
| `JIRA_MAX_RETRIES` | Reintentos ante cortes transitorios de Jira. |
| `JIRA_RETRY_BASE_SECONDS` | Espera base entre reintentos de Jira. |
| `JIRA_PAGE_SIZE` | Cantidad de issues por pagina en Jira. |
| `JIRA_PAGE_SLEEP_SECONDS` | Pausa entre paginas de Jira. |
| `AT_WORKLOG_MAX_PAGES_PER_TEAM` | Limite de paginas por equipo en ActivityTimeline. |
| `AT_WORKLOG_MAX_ROWS_PER_TEAM` | Limite de filas por equipo en ActivityTimeline. |

Si Jira corta la conexion durante `search/jql`, `etl_runner.py` reintenta la pagina. Si ActivityTimeline repite paginas o devuelve demasiadas filas, `etl_runner.py` corta la paginacion para evitar timeouts como `The action 'Ejecutar ETL principal' has timed out after 110 minutes`.

## Desarrollo local

ETL:

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python etl.py --solo-conexion
python etl_runner.py --recrear-modelo --full --sin-jsm
python etl_runner.py --sin-jsm
```

Web:

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

## Proximos pasos

1. Ejecutar nuevamente el workflow `ETL Semanal` en modo incremental.
2. Si el modelo todavia no esta limpio, ejecutar una vez con `modo=full`, `recrear_modelo=true`, `sin_jsm=true`.
3. Verificar que existan las vistas `VW_REPORTE_HORAS_*` y `VW_NOVEDADES_LABORALES` en Turso.
4. Definir si `VW_STATUS_SEMANAL_LIDERES` se alimenta desde carga del Excel, desde una tabla manual o desde datos del ETL.
5. Probar todos los reportes desde Vercel.
