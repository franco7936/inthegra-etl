# Inthegra ETL

Repositorio del ETL y portal de reportes operativos de Inthegra.

El objetivo del proyecto es centralizar datos de Jira y ActivityTimeline en Turso, dejarlos normalizados en tablas de trabajo y exponer reportes consumibles desde una web estatica publicada con GitHub Pages.

## Que resuelve

Este proyecto cubre tres necesidades principales:

- Extraer informacion operativa desde Jira: proyectos, issues, sprints, epicas, worklogs, comentarios, cambios y datos de JSM cuando se habilite.
- Extraer informacion de ActivityTimeline: equipos, usuarios, planificacion, capacidad, eventos y horas reales registradas.
- Preparar una web simple para presentar reportes, empezando por el reporte de horas por persona, equipo y tipo de evento.

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
Tablas normalizadas + vistas de reporte
        |
        v
docs/ publicado con GitHub Pages
```

El proceso principal esta concentrado en `etl.py`. Ya no se usan archivos SQL sueltos ni scripts auxiliares para crear el modelo, migrar columnas o refrescar vistas.

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

## Fuentes de datos

### Jira

Jira se usa para traer informacion de proyectos, issues y actividad asociada.

Tablas principales generadas desde Jira:

| Tabla | Uso |
| --- | --- |
| `rpt_proyectos` | Catalogo de proyectos Jira. |
| `rpt_versiones` | Versiones por proyecto. |
| `rpt_componentes` | Componentes por proyecto. |
| `rpt_sprints` | Sprints asociados a boards Scrum. |
| `rpt_epicas` | Epicas detectadas por board/proyecto. |
| `rpt_issues` | Issues principales con estado, tipo, responsable, estimaciones y fechas. |
| `rpt_worklogs` | Horas cargadas en Jira. |
| `rpt_changelog` | Cambios relevantes de issues. |
| `rpt_issue_links` | Relaciones entre issues. |
| `rpt_comentarios` | Comentarios de issues, guardados como preview. |
| `rpt_jsm_tickets` | Tickets de Jira Service Management, si se ejecuta JSM. |
| `rpt_jsm_slas` | SLAs de JSM, si se ejecuta JSM. |

### ActivityTimeline

ActivityTimeline es la fuente principal para el reporte de horas de equipos.

Tablas vigentes generadas desde ActivityTimeline:

| Tabla | Uso |
| --- | --- |
| `at_equipos` | Equipos existentes en ActivityTimeline. |
| `at_usuarios` | Usuarios de ActivityTimeline. |
| `at_workload` | Planificacion y worklogs reales de ActivityTimeline. |
| `at_capacity` | Capacidad diaria por usuario/equipo. |
| `at_eventos` | Eventos del timeline: booking, Jira issue, day off y otros tipos. |

La tabla `at_availability` fue eliminada del modelo porque no se va a utilizar.

## Modelo de ActivityTimeline

### `at_equipos`

Representa los equipos configurados en ActivityTimeline.

Columnas principales:

| Columna | Descripcion |
| --- | --- |
| `team_id` | Identificador del equipo en ActivityTimeline. |
| `nombre` | Nombre del equipo. |
| `team_type` | Tipo de equipo informado por ActivityTimeline. |
| `fecha_carga` | Fecha/hora en que el ETL cargo el dato. |

### `at_usuarios`

Representa usuarios/personas de ActivityTimeline.

Columnas principales:

| Columna | Descripcion |
| --- | --- |
| `username` | Usuario de ActivityTimeline. Es la clave principal. |
| `full_name` | Nombre completo. |
| `email` | Email del usuario, si viene informado. |
| `posicion` | Posicion/rol informado por ActivityTimeline. |
| `involvement` | Nivel de participacion informado por ActivityTimeline. |
| `enabled` | Indica si el usuario esta activo. |
| `fecha_carga` | Fecha/hora de carga. |

### `at_workload`

Guarda informacion de carga de trabajo. Actualmente se usa para dos tipos de registros:

- `PLANIFICADO`: horas planificadas por usuario, equipo, dia y proyecto.
- `WORKLOG`: horas reales registradas en ActivityTimeline.

Columnas principales:

| Columna | Descripcion |
| --- | --- |
| `team_id` | Equipo de ActivityTimeline, cuando el dato lo trae. |
| `username` | Usuario de ActivityTimeline. |
| `full_name` | Nombre informado por ActivityTimeline. |
| `dia` | Fecha del registro. |
| `dia_semana` | Dia de la semana informado por ActivityTimeline. |
| `horas_plan` | Horas planificadas. Aplica a registros `PLANIFICADO`. |
| `project_key` | Proyecto asociado cuando ActivityTimeline lo informa. |
| `issue_key` | Issue asociada cuando existe. |
| `tipo_registro` | `PLANIFICADO` o `WORKLOG`. |
| `time_spent_seconds` | Tiempo usado en segundos para registros `WORKLOG`. |
| `horas_usadas` | Tiempo usado convertido a horas para registros `WORKLOG`. |
| `worklog_count` | Cantidad de worklogs representados por la fila. |
| `fecha_carga` | Fecha/hora de carga. |

### `at_capacity`

Guarda la capacidad diaria de cada usuario por equipo.

Columnas principales:

| Columna | Descripcion |
| --- | --- |
| `team_id` | Equipo de ActivityTimeline. |
| `username` | Usuario de ActivityTimeline. |
| `full_name` | Nombre completo informado. |
| `dia` | Fecha de capacidad. |
| `dia_semana` | Dia de la semana. |
| `horas_cap` | Horas de capacidad del usuario para ese dia. |
| `capacidad_origen` | Origen del dato, actualmente `AT_CAPACITY`. |
| `fecha_carga` | Fecha/hora de carga. |

### `at_eventos`

Es la tabla base para el reporte de horas por tipo de evento.

Columnas principales:

| Columna | Descripcion |
| --- | --- |
| `evento_id` | Identificador del evento en ActivityTimeline. |
| `username` | Usuario asociado al evento. |
| `team_id` | Equipo asociado al evento. |
| `project_key` | Proyecto informado por ActivityTimeline. |
| `issue_key` | Issue Jira asociada cuando existe. |
| `issue_id` | Identificador interno de la issue, cuando viene informado. |
| `issue_type` | Tipo de issue/evento informado. |
| `event_type` | Tipo de evento usado para agrupar el reporte. |
| `summary` | Descripcion resumida del evento. |
| `planned_start` | Inicio planificado. |
| `planned_end` | Fin planificado. |
| `orig_estimate` | Estimacion original convertida a horas. |
| `rem_estimate` | Estimacion restante convertida a horas. |
| `daily_time_estimate` | Tiempo diario estimado convertido a horas. Es el principal campo de horas para el reporte de eventos. |
| `estimate_per_work_day` | Estimacion por dia laboral convertida a horas. |
| `approved_by` | Usuario aprobador si ActivityTimeline lo informa. |
| `extra_link` | Link adicional informado por ActivityTimeline. |
| `color` | Color del evento informado por ActivityTimeline. |
| `fecha_carga` | Fecha/hora de carga. |

## Mapeos manuales

Hay datos que existen en mas de una fuente pero no siempre llegan con el mismo identificador. Por eso se crearon tablas de mapeo manual.

### `map_at_equipo_proyecto`

Relaciona equipos de ActivityTimeline con proyectos de Jira.

| Columna | Descripcion |
| --- | --- |
| `at_team_id` | Equipo de ActivityTimeline. |
| `at_equipo_nombre` | Nombre del equipo AT, usado como ayuda visual. |
| `jira_project_key` | Key del proyecto Jira. |
| `jira_project_name` | Nombre del proyecto Jira. |
| `criterio_match` | Criterio usado para asociar, por defecto `manual`. |
| `activo` | Indica si la relacion esta vigente. |
| `notas` | Observaciones. |

### `map_persona_fuentes`

Relaciona usuarios/personas entre ActivityTimeline y Jira.

| Columna | Descripcion |
| --- | --- |
| `persona_nombre` | Nombre legible de la persona. |
| `at_username` | Usuario de ActivityTimeline. |
| `jira_account_id` | Account ID de Jira. |
| `email` | Email de la persona. |
| `criterio_match` | Criterio usado para asociar, por defecto `manual`. |
| `activo` | Indica si la relacion esta vigente. |
| `notas` | Observaciones. |

Estos mapeos se cargan directamente en la base de datos. No se cargan desde el front por ahora.

## Vistas vigentes para reporte de horas

El ETL elimina vistas viejas y recrea solo las vistas vigentes para ActivityTimeline.

| Vista | Uso |
| --- | --- |
| `RPT_AT_EVENTOS_DETALLE_HORAS` | Detalle de eventos con fecha, persona, equipo, proyecto, tipo de evento y horas. |
| `RPT_AT_HORAS_PERSONA_TIPO_PERIODO` | Agrupacion por fecha, persona, equipo, proyecto y tipo de evento. |
| `RPT_AT_HORAS_EQUIPO_TIPO_PERIODO` | Agrupacion por fecha, equipo, proyecto y tipo de evento. |

Vistas legadas que el ETL elimina si existen:

- `FACT_CAPACIDAD`
- `RPT_CAPACIDAD_SEMANA`
- `AT_WORKLOAD_RESUMEN_DIARIO`
- `RPT_AT_HORAS_PERSONA_TIPO`
- `RPT_AT_HORAS_USADAS_EVENTO`

## Reporte de horas

El primer reporte a construir sobre la web es el reporte de horas de ActivityTimeline.

La necesidad funcional es:

1. Ver horas por persona, agrupadas por tipo de evento. Ejemplo: una persona tuvo 40 horas en booking, 40 horas en Jira issue y 10 horas en day off.
2. Ver horas por equipo, agrupadas por tipo de evento. Ejemplo: un equipo tuvo 260 horas en booking y 45 horas en day off.
3. Poder filtrar por periodo de fechas.
4. Mostrar el equipo al que pertenece cada persona.

La base de este reporte son los datos de `at_eventos` y las vistas `RPT_AT_*`.

### Estado actual del front

La web esta en `docs/` y ya tiene:

- Home general del portal.
- Navegacion superior con listado de reportes.
- Pagina `reporte-horas.html`.
- Filtros de fecha y equipo.
- Vista por personas.
- Vista por equipos.
- Estilo basado en Bootstrap y colores de Inthegra.

Importante: el front esta preparado visualmente, pero todavia falta conectar datos reales desde Turso o generar un archivo JSON real desde el ETL para que GitHub Pages lo consuma. Actualmente la web puede usar datos estaticos de ejemplo dentro de `docs/data/`.

## Ejecucion del ETL en GitHub Actions

El workflow principal es:

```text
.github/workflows/etl_semanal.yml
```

Se ejecuta automaticamente todos los dias a las 03:00 UTC y tambien se puede lanzar manualmente desde GitHub.

Para lanzarlo manualmente:

1. Entrar al repositorio en GitHub.
2. Ir a `Actions`.
3. Elegir `ETL Semanal - Inthegra`.
4. Presionar `Run workflow`.
5. Elegir los parametros.

Parametros disponibles:

| Parametro | Valores | Uso recomendado |
| --- | --- | --- |
| `modo` | `incremental` o `full` | Usar `full` cuando cambia el modelo o se necesita reconstruir datos historicos. Usar `incremental` para corridas normales. |
| `sin_jsm` | `true` o `false` | Por ahora se recomienda `true` para evitar que JSM alargue la corrida. |

Despues de cambios de modelo, la recomendacion es ejecutar una vez:

```text
modo = full
sin_jsm = true
```

Luego, para el uso normal:

```text
modo = incremental
sin_jsm = true
```

## Ejecucion local

Para correr localmente se necesita Python 3.11 o superior.

Instalar dependencias:

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Crear un archivo `.env` en la raiz del proyecto con las variables necesarias:

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

Correr una carga completa sin JSM:

```bash
python etl.py --full --sin-jsm
```

Correr una carga incremental sin JSM:

```bash
python etl.py --sin-jsm
```

Correr desde una fecha puntual:

```bash
python etl.py --desde 2026-09-01 --sin-jsm
```

Omitir ActivityTimeline:

```bash
python etl.py --sin-at --sin-jsm
```

## Variables y secrets requeridos

En GitHub Actions estas variables deben estar configuradas como secrets del repositorio.

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
| `QMETRY_PROJECT_KEY` | Reservado para integraciones futuras o datos de QMetry. |

## Publicacion de la web

La web se publica desde la carpeta `docs/` usando GitHub Pages.

Workflow:

```text
.github/workflows/pages.yml
```

Para que funcione, en GitHub debe estar habilitado:

```text
Settings -> Pages -> Source -> GitHub Actions
```

El workflow se ejecuta cuando cambia algo dentro de `docs/` o el archivo `.github/workflows/pages.yml`. Tambien se puede lanzar manualmente desde `Actions`.

## Limpieza del modelo anterior

Como parte de la consolidacion del ETL se dejaron fuera:

- `at_availability`, porque no se va a usar.
- SQL de modelo estrella anterior.
- SQL de fixes manuales.
- Scripts auxiliares de migracion, validacion y refresco de vistas.

La idea es que `etl.py` sea la unica fuente de verdad del modelo actual.

## Validaciones que hace el ETL

Al finalizar la carga de ActivityTimeline, el ETL valida que existan:

- Tablas AT requeridas.
- Columnas nuevas de `at_workload`, `at_capacity` y `at_eventos`.
- Vistas vigentes del reporte de horas.

Tambien valida que no queden elementos legados como `at_availability` o vistas anteriores que ya no se usan.

## Problemas comunes

### `ModuleNotFoundError: No module named 'httpx'`

Significa que no se instalaron las dependencias de `requirements.txt`. En GitHub Actions se corrige instalando requirements antes de ejecutar `etl.py`.

### Pages falla con `Get Pages site failed` o `Create Pages site failed`

Revisar que GitHub Pages este habilitado en el repositorio con source `GitHub Actions`.

### El pipeline no actualiza columnas o vistas nuevas

Ejecutar una corrida `full` una vez despues de cambios de modelo. El ETL crea columnas faltantes, elimina `at_availability`, recrea vistas y valida el modelo.

### La corrida tarda demasiado

Usar `sin_jsm = true`. JSM puede alargar la ejecucion. El timeout actual del workflow es de 120 minutos.

### El reporte web no muestra datos reales

La web estatica todavia necesita una capa de datos publicada. Las opciones naturales son:

- Generar un JSON desde el ETL y publicarlo en `docs/data/`.
- Crear un endpoint/API liviano que consulte Turso.
- Generar archivos de datos versionados por periodo para que GitHub Pages los consuma.

## Proximos pasos sugeridos

1. Correr el ETL en modo `full` una vez para reconstruir el modelo actual en Turso.
2. Cargar manualmente los mapeos en `map_at_equipo_proyecto` y `map_persona_fuentes`.
3. Verificar las vistas `RPT_AT_*` en Turso.
4. Definir como se va a alimentar la web con datos reales.
5. Conectar `reporte-horas.html` al dataset real del reporte.
