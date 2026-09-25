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

- Fecha desde
- Fecha hasta
- Proyecto
- Persona
- Tipo de actividad

El filtro de persona usa `person_id` desde `VW_REPORTE_HORAS_DETALLE` y lista las personas disponibles para el periodo seleccionado.

## Exportacion a Excel

La pantalla incluye el boton `Exportar Excel`.

La exportacion toma exactamente la vista filtrada que esta viendo el usuario:

- Si esta seleccionada la vista `Personas`, exporta la matriz por persona/proyecto/tipo de actividad.
- Si esta seleccionada la vista `Proyectos`, exporta la matriz por proyecto/tipo de actividad.
- El archivo incluye los filtros aplicados al momento de exportar.

El archivo se genera en el navegador como `.xls` compatible con Excel, sin agregar dependencias al proyecto Next.js.

## Vistas SQL usadas

- `VW_REPORTE_HORAS_DETALLE`
- `VW_REPORTE_HORAS_PERSONA_TIPO`
- `VW_REPORTE_HORAS_EQUIPO_TIPO`
