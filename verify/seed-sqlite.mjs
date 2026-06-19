// Pre-seed de una base SQLite chica con relación (FK) para el dist-verify.
// Se corre ANTES de levantar el studio, así la introspección ya ve el esquema
// y el ERD puede dibujar tablas + relación, y la grilla mostrar datos.
//
// Uso: node verify/seed-sqlite.mjs [archivo-relativo]   (default: dist-verify.db)
// Importante (gotcha Windows): usar path RELATIVO con cwd = dir del proyecto;
// libsql no parsea bien drive-letters absolutos (file:C:\...).
import { createClient } from "@libsql/client";

const file = process.argv[2] || "dist-verify.db";
const client = createClient({ url: `file:${file}` });

async function main() {
  await client.batch(
    [
      "DROP TABLE IF EXISTS books",
      "DROP TABLE IF EXISTS authors",
      `CREATE TABLE authors (
         id   INTEGER PRIMARY KEY,
         name TEXT NOT NULL
       )`,
      `CREATE TABLE books (
         id        INTEGER PRIMARY KEY,
         title     TEXT NOT NULL,
         author_id INTEGER NOT NULL REFERENCES authors(id)
       )`,
      "INSERT INTO authors (id, name) VALUES (1, 'Borges'), (2, 'Cortazar'), (3, 'Saer')",
      `INSERT INTO books (id, title, author_id) VALUES
         (1, 'Ficciones', 1),
         (2, 'El Aleph', 1),
         (3, 'Rayuela', 2),
         (4, 'Bestiario', 2),
         (5, 'El entenado', 3)`,
    ],
    "write"
  );

  const authors = await client.execute("SELECT count(*) AS n FROM authors");
  const books = await client.execute("SELECT count(*) AS n FROM books");
  console.log(
    `[seed] OK → authors=${authors.rows[0].n} books=${books.rows[0].n} en file:${file}`
  );
}

main().catch((e) => {
  console.error("[seed] ERROR:", e);
  process.exit(1);
});
