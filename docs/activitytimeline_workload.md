# ActivityTimeline workload

`at_workload` es la tabla consolidada de ActivityTimeline para reportes operativos.

## Regla de carga

La carga debe ingresar todos los `event_type` disponibles desde ActivityTimeline, siempre que puedan asociarse a una persona.

Fuentes usadas:

- `timeline`
- `worklog/list`

Tipos esperados desde AT:

- Worklogs de issues.
- Bookings.
- Calendar events.
- Day off, holidays, vacaciones u otros eventos equivalentes que el endpoint entregue como eventos de calendario o workload.

## Asociacion de persona

La persona se resuelve contra `map_personas` usando, en orden:

- `username_at`
- `email_at`
- `full_name_at`
- `user_name_rpt`

Si no se puede resolver `person_id`, el registro se omite para evitar horas sin responsable.

## Asociacion de equipo/proyecto

La asociacion principal se hace por `projectKey` o por la clave del issue Jira.

Para eventos AT que no traen issue Jira ni `projectKey`, se usa como respaldo el equipo del endpoint:

```text
team_id_at -> map_equipo_proyecto.team_id_at -> map_equipo_proyecto.project_id
```

Este respaldo solo se usa si el equipo AT esta asociado a un proyecto Jira activo y con `project_key_rpt` informado.

Esto evita perder eventos como `day_off`, `holiday`, vacaciones u otros eventos calendario que pertenecen al equipo pero no a un issue Jira.

Si existe persona pero no existe un match confiable de equipo/proyecto, el registro se conserva con `project_id` nulo y se visualiza como `Sin proyecto`.

Estos registros solo son visibles para administradores en el reporte de horas. Los usuarios no administradores tienen el reporte operativo filtrado por su `project_id`, por lo que no ven horas sin proyecto ni horas de otros equipos.

## Deduplicacion

`etl_runner_v3.py` agrega `dedupe_key` sobre `at_workload` para evitar duplicar la misma actividad.

La clave contempla:

- `person_id`
- `project_id`
- `issue_key`
- `event_type`
- `summary`
- `planned_start`
- `planned_end`
- `tiempo_empleado`

## Reportes afectados

La mejora impacta especialmente en:

- Reporte de horas.
- Novedades laborales.
- Cualquier vista futura que use eventos AT por tipo de actividad.
