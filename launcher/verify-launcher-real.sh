#!/usr/bin/env bash
# Prueba el camino REAL: el launcher baja el bundle desde el GitHub Release v0.1.0
# (SIN override local), extrae, arranca y sirve datos. Valida lo que va a vivir
# el usuario tras `npm publish`.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO="$(cd "$HERE/.." && pwd)"
PORT="${PORT:-3013}"
# WORK AFUERA de db-studio (sino la resolución de módulos del bundle se filtra a
# db-studio/node_modules y da falso verde con los nativos, ej. libsql).
WORK="$(mktemp -d)/qob-launcher-real"
PASS=0; FAIL=0
ok(){ echo "[PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
port_pid(){ netstat -ano 2>/dev/null | grep ":$PORT " | grep -i listening | awk '{print $NF}' | sort -u | head -1; }
kill_port(){ for p in $(netstat -ano 2>/dev/null | grep ":$PORT " | grep -i listening | awk '{print $NF}' | sort -u); do taskkill //F //T //PID "$p" >/dev/null 2>&1; done; }

LPID=""
cleanup(){ [ -n "$LPID" ] && { kill -INT "$LPID" 2>/dev/null; sleep 1; kill "$LPID" 2>/dev/null; }; kill_port; rm -rf "$WORK"; }
trap cleanup EXIT

rm -rf "$WORK"; mkdir -p "$WORK/userdir" "$WORK/cache"; kill_port

echo "== seed DB en userdir =="
( cd "$WORK/userdir" && node "$STUDIO/verify/seed-sqlite.mjs" mydb.db ) && ok "DB seedeada" || bad "seed falló"

echo "== launcher SIN override → baja el bundle del Release v0.1.0 =="
( cd "$WORK/userdir" && QUICK_OUTERBASE_CACHE="$WORK/cache" \
    node "$HERE/launcher.mjs" --url "file:./mydb.db" --no-open --port "$PORT" >/tmp/launcher_real.log 2>&1 ) &
LPID=$!
up=0; for _ in $(seq 1 90); do [ -n "$(port_pid)" ] && { up=1; break; }; sleep 1; done
[ "$up" = "1" ] && ok "bajó el bundle real y levantó en :$PORT" || { bad "no levantó"; tail -25 /tmp/launcher_real.log; }

echo "== datos OK =="
NB=$(curl -s --max-time 15 -X POST "http://localhost:$PORT/proxy/db" -H "Content-Type: application/json" -d '{"stmts":["SELECT count(*) AS n FROM books"]}' | grep -o '"n":5')
[ "$NB" = '"n":5' ] && ok "books=5 (DB del usuario, descarga real)" || bad "no leyó books=5"

echo "== teardown =="
WPID="$(port_pid)"; kill -INT "$LPID" 2>/dev/null; LPID=""
freed=0; for _ in $(seq 1 10); do [ -z "$(port_pid)" ] && { freed=1; break; }; sleep 1; done
[ "$freed" != "1" ] && [ -n "$WPID" ] && { taskkill //F //T //PID "$WPID" >/dev/null 2>&1; for _ in $(seq 1 6); do [ -z "$(port_pid)" ] && { freed=1; break; }; sleep 1; done; }
[ "$freed" = "1" ] && ok "puerto liberado" || bad "puerto tomado"

echo ""; echo "PASS: $PASS  FAIL: $FAIL"; [ "$FAIL" -eq 0 ] && echo "✅ camino real OK" || echo "❌ con fallos"
[ "$FAIL" -eq 0 ]
