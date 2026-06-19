#!/usr/bin/env bash
# Prueba MÁXIMA: simula una PC nueva. npx baja el launcher del registry de npm
# (cache de npm fresco) → el launcher baja el bundle del Release (cache fresco)
# → arranca y sirve datos. Es exactamente lo que vive el usuario.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO="$(cd "$HERE/.." && pwd)"
PORT="${PORT:-3015}"
# WORK AFUERA de db-studio (sino los módulos faltantes del bundle se resuelven
# desde db-studio/node_modules → falso verde). NO usamos npm_config_cache propio:
# rompe el shim del bin de npx en Git Bash; dejamos el cache default de npm.
WORK="$(mktemp -d)/qob-npx-test"
PASS=0; FAIL=0
ok(){ echo "[PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
port_pid(){ netstat -ano 2>/dev/null | grep ":$PORT " | grep -i listening | awk '{print $NF}' | sort -u | head -1; }
kill_port(){ for p in $(netstat -ano 2>/dev/null | grep ":$PORT " | grep -i listening | awk '{print $NF}' | sort -u); do taskkill //F //T //PID "$p" >/dev/null 2>&1; done; }
LPID=""
cleanup(){ [ -n "$LPID" ] && { kill -INT "$LPID" 2>/dev/null; sleep 1; kill "$LPID" 2>/dev/null; }; kill_port; rm -rf "$WORK"; }
trap cleanup EXIT
rm -rf "$WORK"; mkdir -p "$WORK/userdir" "$WORK/obcache"; kill_port

( cd "$WORK/userdir" && node "$STUDIO/verify/seed-sqlite.mjs" mydb.db ) && ok "DB seedeada" || bad "seed falló"

echo "== npx -y quick-outerbase@0.1.0 (cache de bundle fresco) =="
( cd "$WORK/userdir" && QUICK_OUTERBASE_CACHE="$WORK/obcache" \
    npx -y quick-outerbase@0.1.0 --url "file:./mydb.db" --no-open --port "$PORT" >/tmp/npx_real.log 2>&1 ) &
LPID=$!
up=0; for _ in $(seq 1 120); do [ -n "$(port_pid)" ] && { up=1; break; }; sleep 1; done
[ "$up" = "1" ] && ok "npx bajó launcher+bundle y levantó en :$PORT" || { bad "no levantó"; tail -25 /tmp/npx_real.log; }

NB=$(curl -s --max-time 15 -X POST "http://localhost:$PORT/proxy/db" -H "Content-Type: application/json" -d '{"stmts":["SELECT count(*) AS n FROM books"]}' | grep -o '"n":5')
[ "$NB" = '"n":5' ] && ok "books=5 (camino npx completo, end-to-end)" || bad "no leyó books=5"

WPID="$(port_pid)"; kill -INT "$LPID" 2>/dev/null; LPID=""
freed=0; for _ in $(seq 1 10); do [ -z "$(port_pid)" ] && { freed=1; break; }; sleep 1; done
[ "$freed" != "1" ] && [ -n "$WPID" ] && { taskkill //F //T //PID "$WPID" >/dev/null 2>&1; for _ in $(seq 1 6); do [ -z "$(port_pid)" ] && { freed=1; break; }; sleep 1; done; }
[ "$freed" = "1" ] && ok "puerto liberado" || bad "puerto tomado"

echo ""; echo "PASS: $PASS  FAIL: $FAIL"; [ "$FAIL" -eq 0 ] && echo "✅ npx end-to-end OK" || echo "❌ con fallos"
[ "$FAIL" -eq 0 ]
