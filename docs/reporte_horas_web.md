# Reporte de horas web

Ruta:

```text
/reportes/horas
```

API:

```text
/api/reportes/horas
```

## Fuentes de horas

El reporte combina dos fuentes:

- `at_workload`: horas que vienen desde ActivityTimeline/Jira.
- `pgi_workload`: horas manuales PGI cargadas desde la web cuando no vienen desde Jira.

La vista `VW_REPORTE_HORAS_DETALLE` expone:

- `horas_at`: horas provenientes de ActivityTimeline.
- `horas_pgi`: horas cargadas manualmente en PGI.
- `tiempo_empleado`: total usado por el reporte, calculado como AT + PGI segun la fila.
- `activity_detail_at`: detalle operativo del evento. Para `booking`, el ETL lo deriva del texto posterior al separador `|` dentro de `summary`.

Para eventos de ausencia provenientes de ActivityTimeline (`day_off`, `holiday`, `sick_leave`, `vacation`), si la API no informa horas, la vista calcula 8 horas por cada dia laborable del rango. El `planned_end` se interpreta como fin exclusivo: del 28/09 al 29/09 equivale a 1 dia.

## PGI Log

La pantalla incluye el boton `PGI Log` como accion principal a la derecha de `Exportar Excel`.

Al abrirlo se muestra un popup para cargar:

- Proyecto.
- Persona.
- Fecha.
- Horas.
- Comentario opcional.

Cada carga se guarda en `pgi_workload` y se suma automaticamente al total de horas por persona y proyecto cuando la vista esta actualizada.

## Filtros disponibles

El reporte permite filtrar por:

- Mes
- Proyecto
- Persona
- Tipo de actividad
- Detalle booking

El selector de mes calcula automaticamente el rango completo:

```text
from = primer dia del mes seleccionado
to = ultimo dia del mes seleccionado
```

La API sigue recibiendo `from` y `to` para mantener estable la consulta contra Turso.

## Indicadores principales

La pantalla muestra:

- Total estimado de horas del mes: `personas con horas en el resultado * 8 horas * dias habiles del mes`.
- Horas totales cargadas.
- Horas AT.
- Horas PGI.
- Porcentaje de cobertura contra el estimado.
- Registros incluidos en el filtro.

## Cumplimiento por persona

En la vista `Personas`, la grilla agrupa por persona y muestra una fila por cada proyecto donde esa persona tuvo horas.

Debajo del nombre de cada persona se muestra:

- Ultima fecha de carga de horas dentro del mes filtrado.
- Total de horas cargadas por esa persona, incluyendo AT y PGI.

Estados visuales:

- `Alerta` / rojo: menor a 80% del estimado.
- `Revisar` / naranja: desde 80% y menor a 100%.
- `OK` / verde: igual o mayor a 100%.

## Exportacion a Excel

La pantalla incluye el boton `Exportar Excel`.

La exportacion toma exactamente la vista filtrada que esta viendo el usuario e incluye:

- Filtros aplicados.
- Dias habiles.
- Total estimado de horas.
- Resumen de horas AT, horas PGI y horas totales.
- Matriz por persona/proyecto o por proyecto, segun la vista seleccionada.
- Columnas de tipos de actividad.
- Columna `Total AT`.
- Columna `PGI`.
- Columna `Total fila`.
- Cumplimiento por persona cuando la vista es `Personas`.

El archivo se genera en el navegador como `.xls` compatible con Excel, sin agregar dependencias al proyecto Next.js.

## Vistas SQL usadas

- `VW_REPORTE_HORAS_DETALLE`
- `VW_REPORTE_HORAS_PERSONA_TIPO`
- `VW_REPORTE_HORAS_EQUIPO_TIPO`

Estas vistas se refrescan desde `etl_runner.py`.
