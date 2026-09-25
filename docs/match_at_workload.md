# Matching de `at_workload`

`at_workload` es la tabla consolidada de ActivityTimeline. Para que los reportes de horas sean confiables, cada fila debe quedar asociada a:

- `person_id`, desde `map_personas`.
- `project_id`, desde `map_equipo_proyecto`.

Reglas duras:

- `at_workload` no debe conservar filas con `person_id IS NULL`.
- `at_workload` no debe conservar filas sin `project_id` valido.
- `project_id` debe corresponder a una fila activa de `map_equipo_proyecto` con `project_key_rpt` informado.

Si ActivityTimeline entrega un registro sin identidad de persona o sin proyecto Jira confiable, el ETL lo omite y lo informa en logs.

## Claves fuente guardadas

Ademas de los IDs normalizados, el ETL guarda estas claves originales de ActivityTimeline:

| Columna | Uso |
| --- | --- |
| `username_at` | Usuario original de ActivityTimeline. Es la primera clave para rematchear `person_id`. |
| `user_real_name_at` | Nombre real informado por ActivityTimeline en el `member` o en el item. Se usa como fallback de persona. |
| `user_email_at` | Email informado por ActivityTimeline. Se usa como fallback de persona. |
| `team_id_at` | Equipo original de ActivityTimeline. Se conserva para auditoria, pero no alcanza para cargar horas. |
| `project_key_at` | Project key detectado desde ActivityTimeline, desde `issue_key` o desde el resumen del booking. Es la clave para rematchear `project_id`. |

Estas columnas son importantes porque permiten corregir `map_personas` o `map_equipo_proyecto` y recalcular asociaciones sin depender solamente de IDs viejos.

## Regla de personas

Para `at_workload.person_id` se usa este orden:

1. `username_at` contra `map_personas.username_at`.
2. `user_email_at` contra `map_personas.email_at`.
3. `user_real_name_at` contra `map_personas.full_name_at`.
4. `user_real_name_at` contra `map_personas.user_name_rpt`.

Solo se consideran filas activas:

```sql
COALESCE(map_personas.activo, 1) = 1
```

Esto es necesario porque en ActivityTimeline los `BOOKING`, `DAY_OFF`, `HOLIDAY` y otros eventos no Jira vienen dentro de cada `member` del endpoint `timeline`. La persona esta en el `member`, no siempre dentro del item individual. Por eso el ETL debe arrastrar las claves del `member` hacia cada fila de `at_workload`.

El endpoint `worklog/list` puede devolver elementos de calendario o bookings sin identidad de persona dentro del item. Esos registros se omiten porque no son confiables para un reporte por persona. La fuente preferida para esos eventos es `timeline`, donde vienen agrupados por miembro.

Si hay mas de una fila activa con el mismo `username_at` o `email_at`, el ETL toma el menor `person_id` y deja un warning en logs. La correccion correcta es dejar una sola fila activa por clave.

## Regla de proyectos

Para `at_workload.project_id` se usa `project_key_at` contra `map_equipo_proyecto.project_key_rpt`.

El ETL ya no usa `team_id_at` como fallback para asignar proyecto, porque puede llevar horas a proyectos incorrectos o a equipos AT que no representan un proyecto Jira real.

`project_key_at` se detecta desde:

1. `projectKey` si viene informado por ActivityTimeline.
2. El prefijo de `issue_key` cuando viene con formato Jira, por ejemplo `HC-123`.
3. El inicio de IDs sin guion si coinciden con una key conocida, por ejemplo `BUSINESS...`.
4. El resumen de bookings con formato similar a `[Booking] BUSINESS | ...`.

Si no se detecta una key Jira valida, la fila no se carga en `at_workload`.

## Auditoria

El ETL crea estas vistas:

| Vista | Uso |
| --- | --- |
| `VW_AUDITORIA_AT_WORKLOAD_MATCH` | Muestra por cada `workload_id` el `person_id/project_id` actual, el esperado y el estado del match. |
| `VW_AUDITORIA_MAP_DUPLICADOS` | Lista claves duplicadas activas en `map_personas` y `map_equipo_proyecto`. |

Consultas utiles:

```sql
SELECT *
FROM VW_AUDITORIA_AT_WORKLOAD_MATCH
WHERE estado_persona <> 'OK'
   OR estado_proyecto <> 'OK';
```

```sql
SELECT *
FROM VW_AUDITORIA_MAP_DUPLICADOS;
```

Validaciones duras esperadas:

```sql
SELECT COUNT(*)
FROM at_workload
WHERE person_id IS NULL;
```

```sql
SELECT COUNT(*)
FROM at_workload w
WHERE w.project_id IS NULL
   OR w.project_id NOT IN (
      SELECT project_id
      FROM map_equipo_proyecto
      WHERE project_key_rpt IS NOT NULL
        AND TRIM(project_key_rpt) <> ''
        AND COALESCE(activo, 1) = 1
   );
```

Ambas deben devolver `0`.

## Como corregir mapas

En `map_personas`:

- Completar `username_at` con el usuario de ActivityTimeline.
- Completar `full_name_at` con el nombre de ActivityTimeline.
- Completar `email_at` cuando ActivityTimeline informe email.
- Completar `user_id_rpt` y `user_name_rpt` con el usuario de Jira.
- Dejar `activo = 1` solo para la fila valida.

En `map_equipo_proyecto`:

- Completar `team_id_at`, `nombre_at` y `team_type_at` con ActivityTimeline.
- Completar `project_key_rpt`, `board_id_rpt`, `nombre_rpt`, `tipo_rpt` y `lead_rpt` con Jira.
- Dejar `activo = 1` solo para la asociacion valida.

## Corrida recomendada despues de corregir mapas

Para corregir el periodo reciente sin borrar todo:

```text
modo = incremental
recrear_modelo = false
sin_jsm = true
sin_at = false
sin_worklogs = false
```

La corrida incremental recarga ActivityTimeline para el rango reciente y vuelve a rematchear `at_workload`.

Para corregir historico mas viejo:

```text
modo = full
recrear_modelo = false
sin_jsm = true
sin_at = false
sin_worklogs = false
```

No usar `recrear_modelo = true` salvo que se quiera borrar y recrear todo el modelo.
