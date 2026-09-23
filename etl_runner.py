"""
Runner seguro para etl.py.

Mantiene el ETL principal como fuente de verdad, pero aplica correcciones defensivas
antes de ejecutar main():
- corta la paginacion de usuarios de ActivityTimeline si el endpoint repite pagina;
- baja el ruido de logs HTTP;
- crea vistas SQL complementarias versionadas cuando corresponde.
"""

import logging
import os
import time

import etl

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)


def cargar_at_usuarios_en_map_seguro(at, conn, modo):
    if not at:
        return []

    etl.log.info("Map personas desde ActivityTimeline...")
    now = etl.now_iso()
    rows = []
    offset = 0
    seen_page_users = set()
    max_pages = int(os.getenv("AT_USERS_MAX_PAGES", "50"))

    for page in range(max_pages):
        data = at.get("user", params={"startOffset": offset})
        if not isinstance(data, list) or not data:
            break

        page_users = {u.get("username") for u in data if u.get("username")}
        new_page_users = page_users - seen_page_users
        if page > 0 and not new_page_users:
            etl.log.warning(
                "ActivityTimeline user devolvio una pagina repetida en startOffset=%s; se corta paginacion para evitar timeout",
                offset,
            )
            break

        seen_page_users.update(page_users)
        for u in data:
            username = u.get("username")
            if username:
                rows.append({
                    "username_at": username,
                    "full_name_at": u.get("fullName", ""),
                    "enabled_at": 1 if u.get("enabled") else 0,
                    "fecha_carga_at": now,
                })

        if len(data) < 100:
            break
        offset += len(data)
        time.sleep(0.15)
    else:
        etl.log.warning("ActivityTimeline user alcanzo AT_USERS_MAX_PAGES=%s; se corta paginacion", max_pages)

    # De-duplicar por username conservando el ultimo valor recibido.
    dedup = {r["username_at"]: r for r in rows}
    rows = list(dedup.values())

    existentes = conn.execute("SELECT person_id, username_at FROM map_personas WHERE username_at IS NOT NULL").fetchall()
    por_username = {r[1]: r[0] for r in existentes}
    altas = 0

    for r in rows:
        if r["username_at"] in por_username:
            conn.execute(
                """
                UPDATE map_personas
                SET full_name_at=?, enabled_at=?, fecha_carga_at=?, fecha_carga=?
                WHERE username_at=?
                """,
                (r["full_name_at"], r["enabled_at"], r["fecha_carga_at"], now, r["username_at"]),
            )
        else:
            conn.execute(
                """
                INSERT INTO map_personas
                (username_at,full_name_at,enabled_at,fecha_carga_at,criterio_match,activo,fecha_carga)
                VALUES (?,?,?,?,?,?,?)
                """,
                (r["username_at"], r["full_name_at"], r["enabled_at"], r["fecha_carga_at"], "pendiente", 1, now),
            )
            altas += 1

    conn.commit()
    etl.log.info("Map personas AT: %s usuarios procesados", len(rows))
    etl.log_etl(conn, modo, "map_personas_at", altas, detalle="usuarios AT nuevos; existentes actualizados")
    return rows


def aplicar_vistas_complementarias(conn):
    sql_path = os.path.join(os.path.dirname(__file__), "sql", "vw_novedades_laborales.sql")
    if os.path.exists(sql_path):
        with open(sql_path, "r", encoding="utf-8") as file:
            conn.executescript(file.read())
        conn.commit()
        etl.log.info("Vista complementaria aplicada: VW_NOVEDADES_LABORALES")


_original_refrescar_vistas = etl.refrescar_vistas


def refrescar_vistas_seguro(conn):
    _original_refrescar_vistas(conn)
    aplicar_vistas_complementarias(conn)


etl.cargar_at_usuarios_en_map = cargar_at_usuarios_en_map_seguro
etl.refrescar_vistas = refrescar_vistas_seguro

if __name__ == "__main__":
    etl.main()
