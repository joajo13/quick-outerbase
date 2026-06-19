#!/usr/bin/env bash
# Valida el fix del nativo de libsql: rebuild standalone + ensamblar (con copy de
# @libsql) + testear el launcher DESDE UNA CARPETA AFUERA de db-studio (para que
# la resolución de módulos no se filtre a db-studio/node_modules → test honesto).
set -uo pipefail
STUDIO="C:/Users/Juan/Desktop/projects/fork-outerbase/db-studio"
HERE="$STUDIO/launcher"
PORT=3017
PASS=0; FAIL=0
ok(){ echo "[PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
port_pid(){ netstat -ano 2>/dev/null | grep ":$PORT " | grep -i listening | awk '{print $NF}' | sort -u | head -1; }
kill_port(){ for p in $(netstat -ano 2>/dev/null | grep ":$PORT " | grep -i listening | awk '{print $NF}' | sort -u); do taskkill //F //T //PID "$p" >/dev/null 2>&1; done; }

cd "$STUDIO"
echo "== rebuild standalone =="
rm -rf .next
NEXT_TELEMETRY_DISABLED=1 npx next build >/tmp/fix_build.log 2>&1 && ok "build standalone OK" || { bad "build falló"; tail -15 /tmp/fix_build.log; exit 1; }

echo "== ensamblar bundle CON @libsql (igual que el workflow arreglado) =="
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
mkdir -p .next/standalone/node_modules/@libsql
cp -r node_modules/@libsql/. .next/standalone/node_modules/@libsql/
[ -d node_modules/libsql ] && { mkdir -p .next/standalone/node_modules/libsql; cp -r node_modules/libsql/. .next/standalone/node_modules/libsql/; }
echo "  @libsql en el bundle: $(ls .next/standalone/node_modules/@libsql | tr '\n' ' ')"
ls .next/standalone/node_modules/@libsql | grep -qiE "msvc|gnu|darwin" && ok "el nativo de libsql está en el bundle" || bad "FALTA el nativo de libsql"
tar -czf /tmp/sa2.tgz -C .next/standalone .

echo "== test del launcher DESDE /tmp (afuera de db-studio) =="
TMP="$(mktemp -d)"; mkdir -p "$TMP/cache"
( cd "$TMP" && node "$STUDIO/verify/seed-sqlite.mjs" mydb.db ) >/dev/null 2>&1
kill_port
( cd "$TMP" && QUICK_OUTERBASE_BUNDLE=/tmp/sa2.tgz QUICK_OUTERBASE_CACHE="$TMP/cache" \
    node "$HERE/launcher.mjs" --url "file:./mydb.db" --no-open --port "$PORT" >/tmp/fix_launch.log 2>&1 ) &
LPID=$!
up=0; for _ in $(seq 1 60); do [ -n "$(port_pid)" ] && { up=1; break; }; sleep 1; done
[ "$up" = "1" ] && ok "launcher levantó desde /tmp" || { bad "no levantó"; tail -15 /tmp/fix_launch.log; }
RESP=$(curl -s --max-time 15 -X POST "http://localhost:$PORT/proxy/db" -H "Content-Type: application/json" -d '{"stmts":["SELECT count(*) AS n FROM books"]}')
echo "  proxy: $RESP"
echo "$RESP" | grep -q '"n":5' && ok "books=5 SIN db-studio cerca → libsql nativo OK en el bundle" || bad "sigue fallando libsql"

kill -INT "$LPID" 2>/dev/null; sleep 1; kill_port; rm -rf "$TMP"
echo ""; echo "PASS: $PASS  FAIL: $FAIL"; [ "$FAIL" -eq 0 ] && echo "✅ FIX OK" || echo "❌ fix incompleto"
