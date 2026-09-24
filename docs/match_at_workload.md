# Matching de `at_workload`

`at_workload` es la tabla consolidada de ActivityTimeline. Para que los reportes de horas sean confiables, cada fila debe quedar asociada a:

- `person_id`, desde `map_personas`.
- `project_id`, desde `map_equipo_proyecto`.

## Claves fuente guardadas

Ademas de los IDs normalizados, el ETL guarda estas claves originales de ActivityTimeline:

| Columna | Uso |
| --- | --- |
| `username_at` | Usuario original de ActivityTimeline. Es la clave principal para rematchear `person_id`. |
| `team_id_at` | Equipo original de ActivityTimeline. Se usa como fallback para rematchear `project_id`. |
| `project_key_at` | Project key detectado desde ActivityTimeline o desde `issue_key`. Es la primera opcion para rematchear `project_id`. |

Estas columnas son importantes porque permiten corregir `map_personas` o `map_equipo_proyecto` y recalcular asociaciones sin depender solamente de IDs viejos.

## Regla de personas

Para `at_workload.person_id` se usa:

```sql
lower(trim(at_workload.username_at)) = lower(trim(map_personas.username_at))
```

Solo se consideran filas activas:

```sql
COALESCE(map_personas.activo, 1) = 1
```

Si hay mas de una fila activa con el mismo `username_at`, el ETL toma el menor `person_id` y deja un warning en logs. La correccion correcta es dejar una sola fila activa por `username_at`.

## Regla de proyectos

Para `at_workload.project_id` se usa este orden:

1. `project_key_at` contra `map_equipo_proyecto.project_key_rpt`.
2. Si no hay match, `team_id_at` contra `map_equipo_proyecto.team_id_at`.

Esto evita que todos los registros queden asignados al equipo iterado cuando ActivityTimeline entrega un `issue_key` de otro proyecto.

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

## Como corregir mapas

En `map_personas`:

- Completar `username_at` con el usuario de ActivityTimeline.
- Completar `full_name_at` con el nombre de ActivityTimeline.
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
