import { createClient } from '@libsql/client';

let client;

export function getTursoClient() {
  if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) {
    throw new Error('Faltan TURSO_URL o TURSO_TOKEN');
  }

  if (!client) {
    client = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_TOKEN,
    });
  }

  return client;
}

export function rowsFrom(result) {
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}
