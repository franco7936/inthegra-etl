# Limpieza de Turso desde agosto 2026

Objetivo: conservar en Turso solo datos transaccionales de horas desde el `2026-08-01` en adelante, sin perder las asociaciones manuales.

## Que se limpia

La limpieza borra registros anteriores a la fecha indicada en:

| Tabla | Criterio |
| --- | --- |
| `at_workload` | `date(COALESCE(planned_start, planned_end)) < fecha` |
| `rpt_worklogs` | `date(date_worked) < fecha` |

## Que se conserva

Se conservan tablas de mapeo y contexto:

- `map_personas`
- `map_equipo_proyecto`
- `rpt_issues`
- `rpt_sprints`
- `rpt_epicas`
- `etl_log`

Esto es intencional: los mapas tienen asociaciones manuales y los issues/sprints/epicas sirven como contexto para los reportes aunque una tarea haya sido creada antes de agosto.

## Como ejecutarlo desde GitHub Actions

Usar el workflow:

```text
.github/workflows/etl_semanal.yml
```

Parametros recomendados para dejar horas desde agosto 2026:

```text
modo = incremental
recrear_modelo = false
limpiar_antes_de = 2026-08-01
sin_jsm = true
sin_at = false
sin_worklogs = false
```

El workflow primero ejecuta el ETL y, si termina correctamente, aplica la limpieza solicitada. Esto evita que una corrida incremental vuelva a traer algunos dias anteriores a agosto y los deje en la base.

## Como ejecutarlo manualmente

Simulacion, sin borrar:

```bash
python limpiar_turso_desde.py --desde 2026-08-01
```

Borrado confirmado:

```bash
python limpiar_turso_desde.py --desde 2026-08-01 --confirmar
```

## Verificacion

Despues de ejecutar, estas consultas deberian devolver `0`:

```sql
SELECT COUNT(*)
FROM at_workload
WHERE date(COALESCE(planned_start, planned_end)) < date('2026-08-01');
```

```sql
SELECT COUNT(*)
FROM rpt_worklogs
WHERE date(date_worked) < date('2026-08-01');
```

Para revisar que los matches sigan sanos:

```sql
SELECT *
FROM VW_AUDITORIA_AT_WORKLOAD_MATCH
WHERE estado_persona <> 'OK'
   OR estado_proyecto <> 'OK';
```
