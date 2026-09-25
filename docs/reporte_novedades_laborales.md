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

El reporte toma novedades desde `at_workload` y normaliza estos grupos:

- `day_off`: day off, time off y variantes escritas como `dayoff` o `day-off`.
- `holiday`: vacaciones, holiday, feriados/festivos, PTO y variantes equivalentes. En pantalla se muestra como `Vacaciones`.
- `overtime`: horas extras y variantes escritas como `overtime`, `extra_hours` o `horas extras`.

La normalizacion revisa tanto `event_type` como `summary`, porque ActivityTimeline puede traer la clasificacion en cualquiera de esos campos segun el tipo de registro.

## Calculo de horas

Para `overtime` se usan las horas informadas por ActivityTimeline.

Para `day_off` y `holiday`/vacaciones:

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

- Mes
- Equipo
- Tipo de novedad

El selector de mes calcula automaticamente el rango completo:

```text
from = primer dia del mes seleccionado
to = ultimo dia del mes seleccionado
```

La API sigue recibiendo `from` y `to` para mantener estable la consulta contra Turso.

Los selectores muestran placeholders operativos:

- `Todos los equipos`
- `Todos los tipos`

## Placeholder sin datos

Cuando el filtro aplicado no devuelve registros, la pantalla muestra un placeholder con el mensaje `Sin novedades para mostrar`.

Este estado no es un error: indica que no existen novedades de tipo day off, vacaciones u horas extras para el mes y filtros seleccionados, o que todavia falta correr el ETL para actualizar la vista en Turso.

## Exportacion a Excel

La pantalla incluye el boton `Exportar Excel`.

La exportacion usa exactamente los filtros aplicados en pantalla e incluye:

- Mes aplicado y rango `from/to`.
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
