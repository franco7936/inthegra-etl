-- Retira at_availability del modelo.
-- Ejecutar solo despues de confirmar que refresh_vistas.py y los reportes ya no la consumen.

DROP VIEW IF EXISTS RPT_CAPACIDAD_SEMANA;
DROP VIEW IF EXISTS FACT_CAPACIDAD;
DROP TABLE IF EXISTS at_availability;
