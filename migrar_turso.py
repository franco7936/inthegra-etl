"""
Migracion de SQLite local → Turso via HTTP API
No requiere libsql-experimental — usa httpx directamente.

Uso: python migrar_turso.py
"""

import os
import sqlite3
import json
import httpx
from dotenv import load_dotenv

load_dotenv()

SQLITE_PATH = os.getenv("DB_PATH", "jira_reportes.db")
TURSO_URL   = os.getenv("TURSO_URL", "").replace("libsql://", "https://")
TURSO_TOKEN = os.getenv("TURSO_TOKEN", "")

def turso_exec(client, statements):
    """
    Ejecuta una lista de statements en Turso via HTTP.
    statements: lista de strings SQL o lista de {"sql": ..., "args": [...]}
    """
    requests = []
    for s in statements:
        if isinstance(s, str):
            requests.append({"type": "execute", "stmt": {"sql": s}})
        else:
            requests.append({"type": "execute", "stmt": s})
    requests.append({"type": "close"})

    resp = client.post(
        "/v2/pipeline",
        json={"requests": requests},
        timeout=30
    )
    resp.raise_for_status()
    data = resp.json()

    # Verificar errores en los resultados
    errores = []
    for i, r in enumerate(data.get("results", [])):
        if r.get("type") == "error":
            errores.append(f"Statement {i}: {r.get('error', {}).get('message', 'error')}")
    return errores


def turso_query(client, sql):
    """Ejecuta un SELECT y devuelve filas como lista de dicts."""
    resp = client.post(
        "/v2/pipeline",
        json={"requests": [
            {"type": "execute", "stmt": {"sql": sql}},
            {"type": "close"}
        ]},
        timeout=30
    )
    resp.raise_for_status()
    data = resp.json()

    results = data.get("results", [])
    if not results or results[0].get("type") == "error":
        return []

    result = results[0].get("response", {}).get("result", {})
    cols   = [c["name"] for c in result.get("cols", [])]
    rows   = []
    for row in result.get("rows", []):
        rows.append({cols[i]: v.get("value") for i, v in enumerate(row)})
    return rows


def migrar():
    print("="*55)
    print("MIGRACION SQLite → Turso (HTTP API)")
    print("="*55)
    print(f"Origen:  {SQLITE_PATH}")
    print(f"Destino: {TURSO_URL}")
    print()

    if not TURSO_URL or not TURSO_TOKEN:
        print("ERROR: Faltan TURSO_URL o TURSO_TOKEN en el .env")
        return

    # Conectar a SQLite local
    local = sqlite3.connect(SQLITE_PATH)

    # Cliente HTTP para Turso
    client = httpx.Client(
        base_url=TURSO_URL,
        headers={
            "Authorization": f"Bearer {TURSO_TOKEN}",
            "Content-Type": "application/json",
        }
    )

    # Verificar conexion
    print("Verificando conexion a Turso...")
    try:
        rows = turso_query(client, "SELECT 1 AS ok")
        print(f"✓ Conectado correctamente\n")
    except Exception as e:
        print(f"✗ Error de conexion: {e}")
        return

    # Obtener tablas de SQLite (excluir temporales)
    tablas = [
        r[0] for r in local.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        if not r[0].startswith("_tmp_")
    ]

    print(f"Tablas a migrar: {len(tablas)}")
    for t in tablas:
        n = local.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  - {t}: {n} registros")
    print()

    # Migrar cada tabla
    for tabla in tablas:
        print(f"→ {tabla}...")

        # Obtener DDL
        ddl = local.execute(
            f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{tabla}'"
        ).fetchone()[0]

        # Crear tabla en Turso
        errores = turso_exec(client, [
            f"DROP TABLE IF EXISTS {tabla}",
            ddl
        ])
        if errores:
            print(f"  ERROR creando tabla: {errores}")
            continue

        # Leer datos
        cur   = local.execute(f"SELECT * FROM {tabla}")
        cols  = [d[0] for d in cur.description]
        rows  = cur.fetchall()

        if not rows:
            print(f"  Sin datos — tabla creada vacía")
            continue

        # Insertar en lotes de 50 (HTTP tiene límite de payload)
        cols_str     = ", ".join(cols)
        placeholders = ", ".join(["?" for _ in cols])
        sql_insert   = f"INSERT OR REPLACE INTO {tabla} ({cols_str}) VALUES ({placeholders})"

        insertados = 0
        lote_size  = 50

        for i in range(0, len(rows), lote_size):
            lote     = rows[i:i+lote_size]
            stmts    = []
            for row in lote:
                args = []
                for v in row:
                    if v is None:
                        args.append({"type": "null"})
                    elif isinstance(v, int):
                        args.append({"type": "integer", "value": str(v)})
                    elif isinstance(v, float):
                        args.append({"type": "float", "value": v})
                    else:
                        args.append({"type": "text", "value": str(v)})
                stmts.append({"sql": sql_insert, "args": args})

            errores = turso_exec(client, stmts)
            if errores:
                print(f"  ERROR en lote {i}: {errores[0]}")
            else:
                insertados += len(lote)

        print(f"  ✓ {insertados}/{len(rows)} registros migrados")

    # Migrar vistas
    print("\n→ Creando vistas en Turso...")
    vistas = local.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name"
    ).fetchall()

    for nombre, sql_vista in vistas:
        errores = turso_exec(client, [
            f"DROP VIEW IF EXISTS {nombre}",
            sql_vista
        ])
        if errores:
            print(f"  ✗ {nombre}: {errores[0]}")
        else:
            print(f"  ✓ {nombre}")

    # Resumen final
    print("\n" + "="*55)
    print("RESUMEN EN TURSO")
    print("="*55)
    for tabla in tablas:
        try:
            rows = turso_query(client, f"SELECT COUNT(*) AS n FROM {tabla}")
            n    = rows[0]["n"] if rows else 0
            print(f"  {tabla:<28} {n:>7} registros")
        except Exception as e:
            print(f"  {tabla:<28}  ERROR: {e}")

    local.close()
    client.close()
    print("\n✓ Migracion completada")
    print(f"\nTu DB está online en:")
    print(f"  {TURSO_URL}")

if __name__ == "__main__":
    migrar()
