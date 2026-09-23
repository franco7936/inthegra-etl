# Inthegra ETL

Repositorio del ETL y portal de reportes operativos de Inthegra.

El objetivo del proyecto es centralizar datos de Jira y ActivityTimeline en Turso, asociarlos con identificadores internos propios y exponer reportes consumibles desde una web estatica publicada con GitHub Pages.

## Modelo vigente

El modelo vigente es el modelo v2. La idea principal es no trabajar mas con tablas separadas por fuente cuando el dato necesita estar asociado.

A partir de ahora:

- La relacion equipo/proyecto vive en `map_equipo_proyecto`.
- La relacion persona/usuario vive en `map_personas`.
- ActivityTimeline se consolida en una unica tabla de carga: `at_workload`.
- Jira se mantiene en tablas `rpt_` solo cuando representa informacion propia de Jira.
- Toda vista que use el front debe salir desde SQL y despues ser consumida por la web.

## Arquitectura general

```text
Jira + ActivityTimeline
        |
        v
      etl.py
        |
        v
      Turso
        |
        v
Mapeos + tablas consolidadas + vistas SQL
        |
        v
docs/ publicado con GitHub Pages
```

El proceso principal esta concentrado en `etl.py`. No se usan SQL sueltos ni scripts auxiliares para crear el modelo, migrar columnas o refrescar vistas.

## Estructura del repositorio

```text
.github/workflows/etl_semanal.yml   Automatizacion principal del ETL
.github/workflows/pages.yml         Publicacion de la web en GitHub Pages
docs/                               Portal web de reportes
etl.py                              Proceso principal Jira + ActivityTimeline -> Turso
turso_conn.py                       Adaptador de conexion HTTP a Turso
requirements.txt                    Dependencias Python
README.md                           Documentacion del proyecto
```

## Tablas vigentes

| Tabla | Uso |
| --- | --- |
| `map_equipo_proyecto` | Tabla central para asociar equipos de ActivityTimeline con proyectos de Jira. |
| `map_personas` | Tabla central para asociar usuarios de ActivityTimeline con usuarios de Jira. |
| `at_workload` | Tabla consolidada de ActivityTimeline con eventos, tareas y tiempos. |
| `rpt_issues` | Issues de Jira con `project_id` en lugar de `project_key`. |
| `rpt_worklogs` | Worklogs de Jira con `person_id` y `project_id`. |
| `rpt_sprints` | Sprints de Jira asociados a `project_id`. |
| `rpt_epicas` | Epicas de Jira asociadas a `project_id`. |
| `etl_log` | Log general del ETL. Reemplaza a `rpt_etl_log`. |

## `map_equipo_proyecto`

Esta tabla reemplaza a `at_equipos`, `rpt_proyectos` y `map_at_equipo_proyecto`.

Su objetivo es tener un `project_id` interno incremental que represente la asociacion entre un equipo de ActivityTimeline y un proyecto de Jira.

Columnas:

| Columna | Descripcion |
| --- | --- |
| `project_id` | ID interno incremental. Es el identificador que se usa en el resto del modelo. |
| `team_id_at` | ID del equipo en ActivityTimeline. |
| `nombre_at` | Nombre del equipo en ActivityTimeline. |
| `team_type_at` | Tipo de equipo informado por ActivityTimeline. |
| `fecha_carga_at` | Fecha de carga del dato de ActivityTimeline. |
| `project_key_rpt` | Key del proyecto Jira. |
| `board_id_rpt` | Board principal detectado para el proyecto Jira. |
| `nombre_rpt` | Nombre del proyecto Jira. |
| `tipo_rpt` | Tipo del proyecto Jira. |
| `lead_rpt` | Lead del proyecto Jira. |
| `fecha_carga_rpt` | Fecha de carga del dato de Jira. |
| `criterio_match` | Indica si la asociacion fue automatica por nombre o queda pendiente. |
| `activo` | Indica si la asociacion esta vigente. |
| `fecha_carga` | Fecha de actualizacion de la fila de mapeo. |

### Criterio de asociacion automatica

El ETL usa como base el nombre del proyecto Jira (`nombre_rpt`). Si alguna palabra relevante de `nombre_rpt` aparece dentro de `nombre_at`, se asocia automaticamente.

Ejemplo:

```text
nombre_rpt = Business
nombre_at  = Equipo Business
```

Resultado: ambos quedan asociados con el mismo `project_id`.

Si no hay match automatico, la fila queda con `criterio_match = pendiente` para que se complete manualmente en la base.

## `map_personas`

Esta tabla reemplaza a `at_usuarios` y `map_persona_fuentes`.

Su objetivo es tener un `person_id` interno incremental que represente a la misma persona entre ActivityTimeline y Jira.

Columnas:

| Columna | Descripcion |
| --- | --- |
| `person_id` | ID interno incremental. Es el identificador que se usa en el resto del modelo. |
| `username_at` | Usuario de ActivityTimeline. |
| `full_name_at` | Nombre completo en ActivityTimeline. |
| `enabled_at` | Indica si el usuario esta activo en ActivityTimeline. |
| `fecha_carga_at` | Fecha de carga del dato de ActivityTimeline. |
| `user_id_rpt` | ID de usuario Jira detectado en endpoints de Jira. |
| `user_name_rpt` | Nombre de usuario Jira detectado en endpoints de Jira. |
| `fecha_carga_rpt` | Fecha de carga del dato de Jira. |
| `criterio_match` | Indica si la asociacion fue automatica por nombre o queda pendiente. |
| `activo` | Indica si la persona esta vigente para reporting. |
| `fecha_carga` | Fecha de actualizacion de la fila de mapeo. |

### Criterio de asociacion automatica

El ETL compara `full_name_at` contra `user_name_rpt`. Si los nombres contienen las mismas palabras relevantes, asocia ambas fuentes al mismo `person_id`.

Si no hay match automatico, la fila queda pendiente para completar manualmente.

## `at_workload`

Es la unica tabla vigente para ActivityTimeline. Reemplaza el uso separado de `at_eventos`, `at_workload` anterior y `at_capacity`.

Columnas:

| Columna | Descripcion |
| --- | --- |
| `workload_id` | ID incremental automatico del registro. |
| `person_id` | Persona asociada desde `map_personas`. |
| `project_id` | Proyecto/equipo asociado desde `map_equipo_proyecto`. |
| `issue_key` | Issue Jira asociada, si existe. |
| `event_type` | Tipo de actividad: `WORKLOG`, `BOOKING`, `DAY_OFF`, `JIRA_ISSUE`, etc. |
| `summary` | Resumen o descripcion del trabajo. |
| `planned_start` | Fecha de inicio planificada o fecha del worklog. |
| `planned_end` | Fecha de fin planificada o fecha del worklog. |
| `orig_estimate` | Estimacion original en horas. |
| `rem_estimate` | Estimacion restante en horas. |
| `tiempo_empleado` | Tiempo a usar para calculos de distribucion de horas. |
| `fecha_carga` | Fecha/hora de carga. |

Para registros reales de tipo `WORKLOG`, `tiempo_empleado` sale del tiempo registrado. Para eventos planificados o calendario, se toma la estimacion diaria/original disponible desde ActivityTimeline.

## `rpt_issues`

Se mantiene como tabla principal de issues Jira, pero el campo de proyecto ahora es `project_id`.

Puntos importantes:

- `project_key` deja de ser la relacion principal.
- La relacion con proyecto sale de `map_equipo_proyecto.project_id`.
- Se mantienen datos funcionales como estado, tipo, prioridad, sprint, epica, responsable, fechas y estimaciones.

## `rpt_worklogs`

Se mantiene como tabla de worklogs Jira, pero ahora usa IDs internos.

Cambios principales:

| Antes | Ahora |
| --- | --- |
| `user_id` | `person_id` |
| `project_key` | `project_id` |

La tabla conserva `worklog_id`, `issue_key`, `date_worked`, `hours_logged`, `comentario` y `fecha_carga`.

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

## Vistas para el front

Regla del proyecto: todo dato que se exponga al front debe salir de una vista SQL.

Vistas vigentes:

| Vista | Uso |
| --- | --- |
| `VW_REPORTE_HORAS_DETALLE` | Detalle base del reporte de horas con persona, proyecto, tipo de evento y tiempo. |
| `VW_REPORTE_HORAS_PERSONA_TIPO` | Agrupacion por fecha, persona, proyecto y tipo de actividad. |
| `VW_REPORTE_HORAS_EQUIPO_TIPO` | Agrupacion por fecha, proyecto/equipo y tipo de actividad. |

Flujo esperado para el front:

```text
Tablas consolidadas
        |
        v
Vistas SQL en Turso
        |
        v
Export JSON desde ETL o proceso controlado
        |
        v
GitHub Pages / docs/
```

No se debe exponer el token de Turso directamente en el navegador.

## Reporte de horas

La necesidad funcional del primer reporte es:

1. Ver horas por persona, agrupadas por tipo de actividad.
2. Ver horas por equipo/proyecto, agrupadas por tipo de actividad.
3. Filtrar por periodo de fechas.
4. Mostrar cada persona ya asociada con su equipo/proyecto interno.

La base del reporte ahora es `at_workload` y las vistas `VW_REPORTE_HORAS_*`.

## Ejecucion del ETL en GitHub Actions

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

Luego, corridas normales:

```text
modo = incremental
recrear_modelo = false
sin_jsm = true
```

## Ejecucion local

Instalar dependencias:

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Crear `.env` con:

```bash
JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_API_TOKEN=
JIRA_PROJECTS=
AT_BASE_URL=
AT_TOKEN=
TURSO_URL=
TURSO_TOKEN=
QMETRY_PROJECT_KEY=
```

Probar conexiones:

```bash
python etl.py --solo-conexion
```

Primera reconstruccion del modelo v2:

```bash
python etl.py --recrear-modelo --full --sin-jsm
```

Corrida normal incremental:

```bash
python etl.py --sin-jsm
```

Corrida desde una fecha puntual:

```bash
python etl.py --desde 2026-09-01 --sin-jsm
```

## Variables y secrets requeridos

| Secret | Descripcion |
| --- | --- |
| `JIRA_BASE_URL` | URL base de Jira. |
| `JIRA_EMAIL` | Email del usuario/API de Jira. |
| `JIRA_API_TOKEN` | Token API de Jira. |
| `JIRA_PROJECTS` | Lista de proyectos Jira separados por coma. Si esta vacio, el ETL intenta detectar proyectos visibles. |
| `AT_BASE_URL` | URL base de ActivityTimeline. Si esta vacio, usa la URL de Jira como base. |
| `AT_TOKEN` | Token de ActivityTimeline. |
| `TURSO_URL` | URL de la base Turso. Puede venir como `libsql://`; el adaptador la convierte a `https://`. |
| `TURSO_TOKEN` | Token de acceso a Turso. |
| `QMETRY_PROJECT_KEY` | Reservado para integraciones futuras. |

## Publicacion de la web

La web se publica desde `docs/` usando GitHub Pages.

Workflow:

```text
.github/workflows/pages.yml
```

Configuracion requerida en GitHub:

```text
Settings -> Pages -> Source -> GitHub Actions
```

## Validaciones del ETL

Al finalizar, el ETL valida que existan las tablas y vistas del modelo v2, y que no sigan presentes tablas legadas eliminadas.

Si todavia existen tablas viejas, correr una vez con:

```bash
python etl.py --recrear-modelo --full --sin-jsm
```

## Problemas comunes

### El pipeline falla porque siguen tablas viejas

Ejecutar la primera corrida del modelo v2 con `recrear_modelo = true`.

### El reporte web no muestra datos reales

La web estatica todavia necesita que el ETL o un proceso controlado exporte las vistas `VW_REPORTE_HORAS_*` a JSON dentro de `docs/data/`.

### La corrida tarda demasiado

Usar `sin_jsm = true`. En el modelo v2 JSM no crea tablas, pero se conserva el parametro por compatibilidad.

## Proximos pasos

1. Ejecutar una unica corrida con `modo=full`, `recrear_modelo=true`, `sin_jsm=true`.
2. Revisar `map_equipo_proyecto` y completar asociaciones pendientes.
3. Revisar `map_personas` y completar asociaciones pendientes.
4. Validar datos en `at_workload`, `rpt_issues` y `rpt_worklogs`.
5. Exportar las vistas `VW_REPORTE_HORAS_*` para conectar el front real.
