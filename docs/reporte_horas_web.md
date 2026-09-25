# Reporte de horas web

Ruta:

```text
/reportes/horas
```

API:

```text
/api/reportes/horas
```

## Filtros disponibles

El reporte permite filtrar por:

- Mes
- Proyecto
- Persona
- Tipo de actividad

El selector de mes calcula automaticamente el rango completo:

```text
from = primer dia del mes seleccionado
to = ultimo dia del mes seleccionado
```

La API sigue recibiendo `from` y `to` para mantener estable la consulta contra Turso.

El filtro de persona usa `person_id` desde `VW_REPORTE_HORAS_DETALLE` y lista las personas disponibles para el mes seleccionado.

## Indicadores principales

La pantalla muestra:

- Total estimado de horas del mes: `personas con horas en el resultado * 8 horas * dias habiles del mes`.
- Horas cargadas reales.
- Porcentaje de cobertura contra el estimado.
- Personas, proyectos y registros incluidos en el filtro.

El texto del estimado muestra el mes seleccionado, la cantidad de personas consideradas y los dias habiles calculados.

## Cumplimiento por persona

En la vista `Personas`, la grilla agrupa por persona y muestra una fila por cada proyecto donde esa persona tuvo horas.

Para cada persona se calcula:

```text
horas esperadas = 8 * dias habiles del mes seleccionado
cumplimiento = total horas cargadas por persona / horas esperadas
```

Estados visuales:

- `Cumple`: desde 98% del estimado.
- `Cerca`: desde 85% y menor a 98%.
- `Revisar`: menor a 85%.

Esto sirve para detectar rapidamente si faltan horas de carga por persona en el mes revisado.

## Exportacion a Excel

La pantalla incluye el boton `Exportar Excel`.

La exportacion toma exactamente la vista filtrada que esta viendo el usuario:

- Si esta seleccionada la vista `Personas`, exporta la matriz por persona/proyecto/tipo de actividad e incluye total por persona, estimado por persona, porcentaje de cumplimiento y estado.
- Si esta seleccionada la vista `Proyectos`, exporta la matriz por proyecto/tipo de actividad.
- El archivo incluye el mes aplicado, el rango `from/to`, los dias habiles y el total estimado de horas.

El archivo se genera en el navegador como `.xls` compatible con Excel, sin agregar dependencias al proyecto Next.js.

## Vistas SQL usadas

- `VW_REPORTE_HORAS_DETALLE`
- `VW_REPORTE_HORAS_PERSONA_TIPO`
- `VW_REPORTE_HORAS_EQUIPO_TIPO`
