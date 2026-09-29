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

## Detalle de actividad

El endpoint de ActivityTimeline no entrega un campo separado para el subtipo de `BOOKING` en la respuesta actual.

Campos observados para bookings:

- `issueType`
- `summary`
- `projectKey`
- `plannedStart`
- `plannedEnd`
- `dailyTimeEstimate`
- `originalTimeEstimate`
- `remainingTimeEstimate`

Por eso `at_workload` guarda `activity_detail_at` como campo normalizado para codificar el detalle operativo. Para `BOOKING`, el ETL toma el texto posterior al separador `|` dentro de `summary`.

Ejemplo:

```text
[Booking] BUSINESS | Skills IA -> activity_detail_at = Skills IA
```

Si en el futuro ActivityTimeline empieza a devolver campos nativos como `activityType`, `bookingType` o `category`, el ETL los toma como fallback.

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

Excepcion: si el registro no tiene proyecto asociado y el `issue_key` empieza con `SCRR`, `SML`, `EC` o `DEMO`, el ETL lo omite y la limpieza operativa lo elimina de `at_workload`. Esos prefijos no deben ingresar como horas operativas sin proyecto.

## PGI manual

`pgi_workload` permite cargar horas manuales desde la web.

Columnas clave:

- `person_id`
- `project_id`
- `fecha`
- `horas`
- `incidence_type`
- `comentario`

Tipos de `incidence_type`:

- `pgi`: PGI general. Suma al reporte de horas, pero no entra en novedades laborales.
- `day_off`: Day off. Suma al reporte de horas y a novedades laborales.
- `holiday`: Vacaciones. Suma al reporte de horas y a novedades laborales.
- `overtime`: Horas extras. Suma al reporte de horas y a novedades laborales.

## Novedades laborales

`VW_NOVEDADES_LABORALES` debe tomar datos reales de:

- `at_workload`
- `pgi_workload`

No debe usar fechas hardcodeadas.

La vista normaliza novedades a estos tipos:

- `day_off`
- `holiday`
- `overtime`

Para `day_off` y `holiday`, si el origen no trae horas, se calcula 8 horas por cada dia laborable del rango del evento.

## Deduplicacion

`etl_runner_v3.py` agrega `dedupe_key` sobre `at_workload` para evitar duplicar la misma actividad.

La clave contempla:

- `person_id`
- `project_id`
- `issue_key`
- `event_type`
- `activity_detail_at`
- `summary`
- `planned_start`
- `planned_end`
- `tiempo_empleado`

## Reportes afectados

La mejora impacta especialmente en:

- Reporte de horas.
- Novedades laborales.
- Cualquier vista futura que use eventos AT por tipo de actividad.
