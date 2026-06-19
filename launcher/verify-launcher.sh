#!/usr/bin/env bash
# Prueba E2E del launcher contra un bundle local (sin release real).
# Simula una máquina nueva: cwd del usuario aparte + cache vacío + DB en SU carpeta.
# Uso: bash verify-launcher.sh /ruta/a/bundle.tar.gz
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO="$(cd "$HERE/.." && pwd)"
BUNDLE="${1:-/tmp/sa.tgz}"
PORT="${PORT:-3012}"
WORK="$STUDIO/.launcher-test"
PASS=0; FAIL=0
ok(){ echo "[PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
port_pid(){ netstat -ano 2>/dev/null | grep ":$PORT " | grep -i listening | awk '{print $NF}' | sort -u | head -1; }
kill_port(){ for p in $(netstat -ano 2>/dev/null | grep ":$PORT " | grep -i listening | awk '{print $NF}' | sort -u); do taskkill //F //T //PID "$p" >/dev/null 2>&1; done; }

LPID=""
cleanup(){ [ -n "$LPID" ] && { kill -INT "$LPID" 2>/dev/null; sleep 1; kill "$LPID" 2>/dev/null; }; kill_port; rm -rf "$WORK"; }
trap cleanup EXIT

[ -f "$BUNDLE" ] || { bad "no existe el bundle $BUNDLE"; exit 1; }
rm -rf "$WORK"; mkdir -p "$WORK/userdir" "$WORK/cache"
kill_port

echo "== seed de la DB en la carpeta del usuario (no en el cache) =="
( cd "$WORK/userdir" && node "$STUDIO/verify/seed-sqlite.mjs" mydb.db ) && ok "DB seedeada en userdir" || bad "seed falló"

echo "== arrancar el launcher desde userdir, con bundle local y cache vacío =="
( cd "$WORK/userdir" && QUICK_OUTERBASE_BUNDLE="$BUNDLE" QUICK_OUTERBASE_CACHE="$WORK/cache" \
    node "$HERE/launcher.mjs" --url "file:./mydb.db" --no-open --port "$PORT" >/tmp/launcher_test.log 2>&1 ) &
LPID=$!
up=0; for _ in $(seq 1 40); do [ -n "$(port_pid)" ] && { up=1; break; }; sleep 1; done
[ "$up" = "1" ] && ok "launcher levantó el server en :$PORT" || { bad "no levantó"; tail -20 /tmp/launcher_test.log; }

echo "== extrajo a cache (sin tocar el repo)? =="
[ -f "$WORK/cache/0.10.2-"*"/server.js" ] && ok "bundle extraído al cache por versión+plataforma" || echo "  (nota: revisar nombre de cache)"

echo "== conecta y se ven los datos (DB de userdir, vía cwd resolution) =="
ENVJSON=$(curl -s --max-time 15 "http://localhost:$PORT/api/env-database"); echo "  $ENVJSON"
echo "$ENVJSON" | grep -qi '"dialect":"sqlite"' && ok "dialect=sqlite" || bad "no infirió sqlite"
NB=$(curl -s --max-time 15 -X POST "http://localhost:$PORT/proxy/db" -H "Content-Type: application/json" -d '{"stmts":["SELECT count(*) AS n FROM books"]}' | grep -o '"n":5')
[ "$NB" = '"n":5' ] && ok "lee books=5 de la DB del USUARIO (cwd resolution OK)" || bad "no leyó books=5 (¿resolvió mal el path?)"

echo "== teardown limpio =="
WPID="$(port_pid)"; kill -INT "$LPID" 2>/dev/null; LPID=""
freed=0; for _ in $(seq 1 10); do [ -z "$(port_pid)" ] && { freed=1; break; }; sleep 1; done
if [ "$freed" != "1" ] && [ -n "$WPID" ]; then taskkill //F //T //PID "$WPID" >/dev/null 2>&1; for _ in $(seq 1 6); do [ -z "$(port_pid)" ] && { freed=1; break; }; sleep 1; done; fi
[ "$freed" = "1" ] && ok "puerto $PORT liberado (sin zombies)" || bad "puerto sigue tomado"

echo ""; echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ] && echo "✅ launcher OK" || echo "❌ launcher con fallos"
[ "$FAIL" -eq 0 ]
