// Seed de una base SQLite tipo e-commerce ("shopdb") con datos y relaciones, pensada
// para PROBAR el chat de IA a mano: tiene varias tablas con FKs, estados variados y
// volumen suficiente para que las agregaciones (GROUP BY, JOIN, count/sum) devuelvan
// algo interesante.
//
// Uso:  node verify/seed-shopdb.mjs [archivo-relativo]   (default: shopdb.db)
// Después:  DATABASE_URL=file:shopdb.db npm run dev   →   http://localhost:3008/env
//
// Gotcha Windows (igual que seed-sqlite.mjs): usar path RELATIVO con cwd = dir del
// proyecto; @libsql/client no parsea bien drive-letters absolutos (file:C:\...).
import { createClient } from "@libsql/client";

const file = process.argv[2] || "shopdb.db";
const client = createClient({ url: `file:${file}` });

// RNG determinístico (LCG) → el seed es reproducible corrida a corrida.
let _s = 123456789;
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const ri = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
// Elección ponderada: [[valor, peso], ...].
const weighted = (pairs) => {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) {
    if ((r -= w) <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
};
const isoDaysAgo = (n) =>
  new Date(Date.now() - n * 86400000 - ri(0, 86399) * 1000).toISOString();

const FIRST = ["Juan", "Sofía", "Mateo", "Valentina", "Lucas", "Camila", "Benjamín", "Martina", "Thiago", "Emma", "Bruno", "Julieta", "Nicolás", "Renata", "Tomás", "Delfina", "Franco", "Isabella", "Diego", "Catalina"];
const LAST = ["Gómez", "Fernández", "Rodríguez", "López", "Martínez", "Pérez", "García", "Sánchez", "Romero", "Álvarez", "Torres", "Ruiz", "Díaz", "Silva", "Castro"];
const COUNTRIES = ["AR", "UY", "CL", "BR", "MX", "ES", "US"];
const CATEGORIES = ["Electrónica", "Libros", "Hogar", "Juguetes", "Ropa", "Deportes", "Alimentos", "Belleza"];
const ADJS = ["Pro", "Max", "Lite", "Ultra", "Clásico", "Premium", "Eco", "Smart", "Vintage", "Compacto"];
const NOUNS_BY_CAT = {
  "Electrónica": ["Auricular", "Parlante", "Cargador", "Teclado", "Monitor", "Cámara"],
  "Libros": ["Novela", "Ensayo", "Manual", "Antología", "Cuento", "Biografía"],
  "Hogar": ["Lámpara", "Sartén", "Almohada", "Cortina", "Organizador", "Vela"],
  "Juguetes": ["Rompecabezas", "Muñeco", "Bloques", "Peluche", "Auto", "Juego"],
  "Ropa": ["Remera", "Campera", "Pantalón", "Zapatilla", "Gorra", "Buzo"],
  "Deportes": ["Pelota", "Mancuerna", "Bicicleta", "Colchoneta", "Raqueta", "Botella"],
  "Alimentos": ["Café", "Chocolate", "Aceite", "Té", "Miel", "Snack"],
  "Belleza": ["Crema", "Perfume", "Shampoo", "Máscara", "Serum", "Bálsamo"],
};
const ORDER_STATUS = [["cart", 8], ["placed", 10], ["paid", 18], ["shipped", 16], ["delivered", 30], ["cancelled", 10], ["refunded", 8]];
const EVENT_TYPES = [["page_view", 45], ["click", 22], ["search", 12], ["add_to_cart", 10], ["login", 6], ["purchase", 5]];

const COUNTS = { users: 150, products: 60, orders: 400, events: 4000 };

async function main() {
  // Esquema. FKs explícitas → el ERD dibuja relaciones y el chat puede razonar joins.
  await client.batch(
    [
      "DROP TABLE IF EXISTS order_items",
      "DROP TABLE IF EXISTS orders",
      "DROP TABLE IF EXISTS events",
      "DROP TABLE IF EXISTS products",
      "DROP TABLE IF EXISTS categories",
      "DROP TABLE IF EXISTS users",
      `CREATE TABLE users (
         id         INTEGER PRIMARY KEY,
         name       TEXT NOT NULL,
         email      TEXT NOT NULL UNIQUE,
         country    TEXT NOT NULL,
         active     INTEGER NOT NULL DEFAULT 1,
         created_at TEXT NOT NULL
       )`,
      `CREATE TABLE categories (
         id   INTEGER PRIMARY KEY,
         name TEXT NOT NULL UNIQUE
       )`,
      `CREATE TABLE products (
         id          INTEGER PRIMARY KEY,
         name        TEXT NOT NULL,
         category_id INTEGER NOT NULL REFERENCES categories(id),
         price       REAL NOT NULL,
         stock       INTEGER NOT NULL
       )`,
      `CREATE TABLE orders (
         id         INTEGER PRIMARY KEY,
         user_id    INTEGER NOT NULL REFERENCES users(id),
         status     TEXT NOT NULL,
         total      REAL NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE TABLE order_items (
         id         INTEGER PRIMARY KEY,
         order_id   INTEGER NOT NULL REFERENCES orders(id),
         product_id INTEGER NOT NULL REFERENCES products(id),
         quantity   INTEGER NOT NULL,
         unit_price REAL NOT NULL
       )`,
      `CREATE TABLE events (
         id         INTEGER PRIMARY KEY,
         user_id    INTEGER NOT NULL REFERENCES users(id),
         type       TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
    ],
    "write"
  );

  // --- Datos en memoria (así mantenemos consistencia: orders.total = suma de items) ---
  const users = Array.from({ length: COUNTS.users }, (_, i) => {
    const id = i + 1;
    const first = pick(FIRST);
    const last = pick(LAST);
    return [
      id,
      `${first} ${last}`,
      `${first}.${last}.${id}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + "@example.com",
      pick(COUNTRIES),
      weighted([[1, 8], [0, 2]]), // ~80% activos
      isoDaysAgo(ri(0, 365)),
    ];
  });

  const categories = CATEGORIES.map((name, i) => [i + 1, name]);

  const products = Array.from({ length: COUNTS.products }, (_, i) => {
    const catId = ri(1, CATEGORIES.length);
    const noun = pick(NOUNS_BY_CAT[CATEGORIES[catId - 1]]);
    const price = Math.round((rnd() * 480 + 20) * 100) / 100; // 20.00 – 500.00
    return [i + 1, `${noun} ${pick(ADJS)}`, catId, price, ri(0, 300)];
  });

  const orders = [];
  const orderItems = [];
  let itemId = 1;
  for (let id = 1; id <= COUNTS.orders; id++) {
    const status = weighted(ORDER_STATUS);
    const nItems = ri(1, 5);
    let total = 0;
    for (let k = 0; k < nItems; k++) {
      const prod = products[ri(0, products.length - 1)];
      const qty = ri(1, 4);
      const unit = prod[3];
      total += qty * unit;
      orderItems.push([itemId++, id, prod[0], qty, unit]);
    }
    orders.push([id, ri(1, COUNTS.users), status, Math.round(total * 100) / 100, isoDaysAgo(ri(0, 180))]);
  }

  const events = Array.from({ length: COUNTS.events }, (_, i) => [
    i + 1,
    ri(1, COUNTS.users),
    weighted(EVENT_TYPES),
    isoDaysAgo(ri(0, 90)),
  ]);

  // --- Inserts en chunks parametrizados ---
  await insertMany(users, "INSERT INTO users (id,name,email,country,active,created_at) VALUES (?,?,?,?,?,?)");
  await insertMany(categories, "INSERT INTO categories (id,name) VALUES (?,?)");
  await insertMany(products, "INSERT INTO products (id,name,category_id,price,stock) VALUES (?,?,?,?,?)");
  await insertMany(orders, "INSERT INTO orders (id,user_id,status,total,created_at) VALUES (?,?,?,?,?)");
  await insertMany(orderItems, "INSERT INTO order_items (id,order_id,product_id,quantity,unit_price) VALUES (?,?,?,?,?)");
  await insertMany(events, "INSERT INTO events (id,user_id,type,created_at) VALUES (?,?,?,?)");

  const n = async (t) => (await client.execute(`SELECT count(*) AS c FROM ${t}`)).rows[0].c;
  console.log(
    `[seed] OK → users=${await n("users")} categories=${await n("categories")} ` +
      `products=${await n("products")} orders=${await n("orders")} ` +
      `order_items=${await n("order_items")} events=${await n("events")} en file:${file}`
  );
}

async function insertMany(rows, sql) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await client.batch(
      rows.slice(i, i + CHUNK).map((args) => ({ sql, args })),
      "write"
    );
  }
}

main().catch((e) => {
  console.error("[seed] ERROR:", e);
  process.exit(1);
});
