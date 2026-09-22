"""
Adaptador de conexion Turso que imita la interfaz de sqlite3.Connection.
Permite usar el ETL sin cambiar nada de la logica de negocio.
Usa la HTTP API de Turso — no requiere libsql-experimental.
"""

import os
import httpx
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

TURSO_URL   = os.getenv("TURSO_URL", "").replace("libsql://", "https://")
TURSO_TOKEN = os.getenv("TURSO_TOKEN", "")


class TursoCursor:
    """Cursor minimo compatible con sqlite3.Cursor."""
    def __init__(self, conn):
        self._conn        = conn
        self.description  = None
        self._rows        = []

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows

    def __iter__(self):
        return iter(self._rows)


class TursoConn:
    """
    Conexion a Turso via HTTP que imita sqlite3.Connection.
    Soporta: execute(), executemany(), executescript(), commit(), close()
    y pandas to_sql() a traves de un SQLAlchemy-like shim.
    """

    def __init__(self, url: str = None, token: str = None):
        self._url   = (url or TURSO_URL).rstrip("/")
        self._token = token or TURSO_TOKEN
        self._client = httpx.Client(
            base_url=self._url,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type":  "application/json",
            },
            timeout=60
        )
        self._pending = []   # statements pendientes de commit

    def _pipeline(self, statements: list) -> list:
        """Envia un pipeline de statements a Turso y devuelve los resultados."""
        reqs = []
        for s in statements:
            if isinstance(s, str):
                reqs.append({"type": "execute", "stmt": {"sql": s}})
            elif isinstance(s, dict):
                reqs.append({"type": "execute", "stmt": s})
        reqs.append({"type": "close"})

        resp = self._client.post("/v2/pipeline", json={"requests": reqs})
        resp.raise_for_status()
        return resp.json().get("results", [])

    def _to_turso_arg(self, v):
        if v is None:
            return {"type": "null"}
        elif isinstance(v, bool):
            return {"type": "integer", "value": "1" if v else "0"}
        elif isinstance(v, int):
            return {"type": "integer", "value": str(v)}
        elif isinstance(v, float):
            return {"type": "float", "value": v}
        else:
            return {"type": "text", "value": str(v)}

    def _is_read_statement(self, sql: str) -> bool:
        head = sql.upper().lstrip().split(None, 1)[0]
        return head in {"SELECT", "WITH", "PRAGMA"}

    def _cursor_from_results(self, results: list) -> TursoCursor:
        cursor = TursoCursor(self)
        if not results:
            return cursor

        r = results[0]
        if r.get("type") == "error":
            msg = r.get("error", {}).get("message", "unknown error")
            raise Exception(f"Error ejecutando consulta: {msg}")
        if r.get("type") != "ok":
            return cursor

        res = r.get("response", {}).get("result", {})
        cols = [c["name"] for c in res.get("cols", [])]
        cursor.description = [(c, None, None, None, None, None, None) for c in cols]
        cursor._rows = [
            tuple(
                cell.get("value") if cell.get("type") != "null" else None
                for cell in row
            )
            for row in res.get("rows", [])
        ]
        return cursor

    def execute(self, sql: str, params=None):
        """Ejecuta un statement. Las lecturas devuelven filas inmediatamente."""
        sql = sql.strip()
        if not sql:
            return TursoCursor(self)

        if params:
            stmt = {"sql": sql, "args": [self._to_turso_arg(v) for v in params]}
            results = self._pipeline([stmt])
            return self._cursor_from_results(results)

        if self._is_read_statement(sql):
            results = self._pipeline([sql])
            return self._cursor_from_results(results)

        self._pending.append(sql)
        return TursoCursor(self)

    def executemany(self, sql: str, params_list):
        """Ejecuta el mismo statement con multiples sets de parametros."""
        if not params_list:
            return
        stmts = [
            {"sql": sql, "args": [self._to_turso_arg(v) for v in params]}
            for params in params_list
        ]
        # Enviar en lotes de 100
        for i in range(0, len(stmts), 100):
            lote = stmts[i:i+100]
            results = self._pipeline(lote)
            for j, r in enumerate(results[:-1]):  # ignorar el close
                if r.get("type") == "error":
                    raise Exception(f"Error en executemany lote {i+j}: {r.get('error',{}).get('message','')}")

    def executescript(self, sql: str):
        """Ejecuta multiples statements separados por ;"""
        stmts = [s.strip() for s in sql.split(";") if s.strip() and not s.strip().startswith("--")]
        for stmt in stmts:
            self._pending.append(stmt)
        self.commit()

    def commit(self):
        """Envia todos los statements pendientes a Turso."""
        if not self._pending:
            return
        results = self._pipeline(self._pending)
        for i, r in enumerate(results[:-1]):
            if r.get("type") == "error":
                msg = r.get("error", {}).get("message", "unknown error")
                # Ignorar errores de tabla ya existente (IF NOT EXISTS)
                if "already exists" not in msg.lower():
                    raise Exception(f"Error en statement {i}: {msg}\nSQL: {self._pending[i][:100]}")
        self._pending = []

    def close(self):
        if self._pending:
            self.commit()
        self._client.close()

    def to_sql_df(self, df: pd.DataFrame, tabla: str, if_exists: str = "replace",
                  chunksize: int = 100):
        """
        Equivalente a df.to_sql() pero escribe en Turso.
        if_exists: 'replace' (borra y recrea), 'append' (solo inserta)
        """
        if df.empty:
            return 0

        # Inferir tipos de columnas
        def dtype_sql(dtype):
            if "int" in str(dtype):   return "INTEGER"
            if "float" in str(dtype): return "REAL"
            return "TEXT"

        if if_exists == "replace":
            # Recrear tabla
            cols_ddl = ", ".join([
                f"{col} {dtype_sql(df[col].dtype)}"
                for col in df.columns
            ])
            self._pending.append(f"DROP TABLE IF EXISTS {tabla}")
            self._pending.append(f"CREATE TABLE IF NOT EXISTS {tabla} ({cols_ddl})")
            self.commit()

        # Insertar en lotes
        cols_str     = ", ".join(df.columns)
        placeholders = ", ".join(["?" for _ in df.columns])
        sql_insert   = f"INSERT OR REPLACE INTO {tabla} ({cols_str}) VALUES ({placeholders})"

        import math

        def limpiar(v):
            if v is None:
                return None
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                return None
            return v

        rows_list = [
            [limpiar(v) for v in row]
            for row in df.where(pd.notnull(df), None).values.tolist()
        ]
        insertados = 0

        for i in range(0, len(rows_list), chunksize):
            lote = rows_list[i:i+chunksize]
            self.executemany(sql_insert, lote)
            insertados += len(lote)

        return insertados


def conectar_turso() -> TursoConn:
    """Crea y verifica una conexion a Turso."""
    if not TURSO_URL or not TURSO_TOKEN:
        raise ValueError("Faltan TURSO_URL o TURSO_TOKEN en el .env")
    conn = TursoConn()
    # Verificar conexion
    conn.execute("SELECT 1 AS ok")
    return conn
