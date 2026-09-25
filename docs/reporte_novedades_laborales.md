# Reporte de novedades laborales

Ruta:

```text
/reportes/novedades-laborales
```

API:

```text
/api/reportes/novedades-laborales
```

Vista SQL:

```text
VW_NOVEDADES_LABORALES
```

## Datos incluidos

El reporte toma novedades desde `at_workload` y normaliza estos tipos:

- `day_off`
- `holiday`
- `overtime`

## Calculo de horas

Para `overtime` se usan las horas informadas por ActivityTimeline.

Para `day_off` y `holiday`:

1. Si ActivityTimeline informa horas, se usan esas horas.
2. Si no informa horas o informa `0`, se calculan horas por dias laborables.
3. Cada dia laborable equivale a `8` horas.
4. Solo cuentan lunes a viernes.
5. Cuando hay rango con fecha fin posterior a fecha inicio, la fecha fin se interpreta como exclusiva.

Ejemplo:

```text
2026-09-28 al 2026-09-29 = 1 dia laborable = 8 horas
```

Si el rango cruza un fin de semana, sabado y domingo no suman horas.

## Filtros disponibles

- Fecha desde
- Fecha hasta
- Equipo
- Tipo de novedad

## Exportacion a Excel

La pantalla incluye el boton `Exportar Excel`.

La exportacion usa exactamente los filtros aplicados en pantalla e incluye:

- Filtros aplicados.
- Resumen del periodo.
- Distribucion por tipo.
- Agrupacion visible: personas o equipos, segun la vista seleccionada.
- Detalle de novedades.

El archivo se genera en el navegador como `.xls` compatible con Excel, sin agregar dependencias al proyecto Next.js.

## Salidas del reporte

La pantalla muestra:

- Resumen de horas, novedades, personas y equipos.
- Distribucion por tipo.
- Agrupacion por persona.
- Agrupacion por equipo.
- Detalle por fecha/persona/equipo/tipo.
