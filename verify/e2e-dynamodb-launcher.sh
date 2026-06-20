#!/usr/bin/env bash
# E2E: el LAUNCHER (con bundle local) contra DynamoDB Local, validando A2 (whitelist
# de env: las creds AWS del entorno deben llegar al server) y que NINGÚN secreto AWS
# salga al cliente. Simula el flujo del browser: región/endpoint van por headers
# x-aws-* (NO secretos); las creds las resuelve el server desde su env.
#
# Uso: bash verify/e2e-dynamodb-launcher.sh /ruta/bundle.tar.gz
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO="$(cd "$HERE/.." && pwd)"
BUNDLE="${1:-/tmp/qob-bundle.tar.gz}"
PORT="${PORT:-3014}"
EP="http://localhost:8000"
REG="us-east-1"
BASE="http://localhost:$PORT"
WORK="$(mktemp -d)/qob-ddb"
PASS=0; FAIL=0
ok(){ echo "[PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
port_pid(){ netstat -ano 2>/dev/null | grep ":$PORT " | grep -i listening | awk '{print $NF}' | sort -u | head -1; }
kill_port(){ for p in $(netstat -ano 2>/dev/null | grep ":$PORT " | grep -i listening | awk '{print $NF}' | sort -u); do taskkill //F //T //PID "$p" >/dev/null 2>&1; done; }
LPID=""
cleanup(){ [ -n "$LPID" ] && { kill -INT "$LPID" 2>/dev/null; sleep 1; kill "$LPID" 2>/dev/null; }; kill_port; rm -rf "$WORK"; }
trap cleanup EXIT
ddb(){ curl -s --max-time 20 -X POST "$BASE/proxy/dynamodb" -H "Content-Type: application/json" -H "x-aws-region: $REG" -H "x-aws-endpoint: $EP" -d "$1"; }

[ -f "$BUNDLE" ] || { bad "no existe el bundle $BUNDLE"; exit 1; }
mkdir -p "$WORK/userdir" "$WORK/cache"; kill_port

echo "== arrancar launcher (creds AWS fake SOLO en el env del launcher) =="
( cd "$WORK/userdir" && AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake \
    QUICK_OUTERBASE_BUNDLE="$BUNDLE" QUICK_OUTERBASE_CACHE="$WORK/cache" \
    node "$HERE/../launcher/launcher.mjs" --url "dynamodb://$REG?endpoint=$EP" --no-open --port "$PORT" \
    >/tmp/ddb_launcher.log 2>&1 ) &
LPID=$!
up=0; for _ in $(seq 1 40); do [ -n "$(port_pid)" ] && { up=1; break; }; sleep 1; done
[ "$up" = "1" ] && ok "launcher levantó el server en :$PORT" || { bad "no levantó"; tail -25 /tmp/ddb_launcher.log; exit 1; }

echo "== /api/env-database: autoconnect dynamodb SIN secretos =="
ENVJSON=$(curl -s --max-time 15 "$BASE/api/env-database"); echo "  $ENVJSON"
echo "$ENVJSON" | grep -qi '"dialect":"dynamodb"' && ok "dialect=dynamodb (autoconnect)" || bad "no infirió dynamodb"
echo "$ENVJSON" | grep -qi 'us-east-1' && ok "region expuesta (no es secreto)" || bad "no expuso region"
if echo "$ENVJSON" | grep -qiE 'fake|secret|accesskey|aws_'; then bad "FUGA: /api/env-database expone algo sensible"; else ok "/api/env-database SIN secretos AWS"; fi

echo "== ListTables (creds resueltas del ENV del server → valida A2) =="
LT=$(ddb '{"action":"ListTables","params":{}}'); echo "  $LT"
echo "$LT" | grep -qi 'Users' && ok "ListTables ve Users (las creds del env llegaron al server: A2 OK)" || bad "ListTables falló (¿se rompió el passthrough de env?)"

echo "== Scan: 5 items =="
SC=$(ddb '{"action":"Scan","params":{"TableName":"Users"}}')
echo "$SC" | grep -qi '"Count":5' && ok "Scan Users Count=5" || { echo "  $SC" | head -c 300; bad "Scan no devolvió 5"; }

echo "== GetItem u1 =="
GI=$(ddb '{"action":"GetItem","params":{"TableName":"Users","Key":{"id":"u1"}}}')
echo "$GI" | grep -qi 'Ada Lovelace' && ok "GetItem u1 = Ada Lovelace" || bad "GetItem falló"

echo "== PutItem u6 =="
PI=$(ddb '{"action":"PutItem","params":{"TableName":"Users","Item":{"id":"u6","name":"Linus Torvalds","age":54}}}')
GI6=$(ddb '{"action":"GetItem","params":{"TableName":"Users","Key":{"id":"u6"}}}')
echo "$GI6" | grep -qi 'Linus Torvalds' && ok "PutItem u6 OK (CRUD create)" || bad "PutItem falló"

echo "== UpdateItem u6 (age=55) =="
ddb '{"action":"UpdateItem","params":{"TableName":"Users","Key":{"id":"u6"},"UpdateExpression":"SET age = :a","ExpressionAttributeValues":{":a":55}}}' >/dev/null
GI6b=$(ddb '{"action":"GetItem","params":{"TableName":"Users","Key":{"id":"u6"}}}')
echo "$GI6b" | grep -qi '"age":55' && ok "UpdateItem u6 age=55 (CRUD update)" || bad "UpdateItem falló"

echo "== ExecuteStatement (PartiQL) =="
PQ=$(ddb '{"action":"ExecuteStatement","params":{"Statement":"SELECT * FROM \"Users\" WHERE id = '"'"'u2'"'"'"}}')
echo "$PQ" | grep -qi 'Alan Turing' && ok "PartiQL SELECT u2 = Alan Turing" || { echo "  $PQ" | head -c 300; bad "PartiQL falló"; }

echo "== DeleteItem u6 (CRUD delete) =="
ddb '{"action":"DeleteItem","params":{"TableName":"Users","Key":{"id":"u6"}}}' >/dev/null
GI6c=$(ddb '{"action":"GetItem","params":{"TableName":"Users","Key":{"id":"u6"}}}')
echo "$GI6c" | grep -qi 'Linus' && bad "DeleteItem no borró u6" || ok "DeleteItem u6 OK"

echo "== CreateTable Temp + DeleteTable Temp =="
ddb '{"action":"CreateTable","params":{"TableName":"TempE2E","AttributeDefinitions":[{"AttributeName":"pk","AttributeType":"S"}],"KeySchema":[{"AttributeName":"pk","KeyType":"HASH"}],"BillingMode":"PAY_PER_REQUEST"}}' >/dev/null
sleep 2
LT2=$(ddb '{"action":"ListTables","params":{}}')
echo "$LT2" | grep -qi 'TempE2E' && ok "CreateTable TempE2E OK" || bad "CreateTable falló"
ddb '{"action":"DeleteTable","params":{"TableName":"TempE2E"}}' >/dev/null
sleep 2
LT3=$(ddb '{"action":"ListTables","params":{}}')
echo "$LT3" | grep -qi 'TempE2E' && bad "DeleteTable no borró TempE2E" || ok "DeleteTable TempE2E OK"

echo "== NINGÚN secreto AWS en las respuestas del proxy =="
ALL="$LT $SC $GI $PQ $LT2"
if echo "$ALL" | grep -qiE 'fake|secretaccesskey|x-aws-|AWS_SECRET'; then bad "FUGA: aparece un secreto/credencial en la respuesta del proxy"; else ok "respuestas del proxy SIN secretos AWS"; fi

echo "== teardown limpio =="
WPID="$(port_pid)"; kill -INT "$LPID" 2>/dev/null; LPID=""
freed=0; for _ in $(seq 1 10); do [ -z "$(port_pid)" ] && { freed=1; break; }; sleep 1; done
if [ "$freed" != "1" ] && [ -n "$WPID" ]; then taskkill //F //T //PID "$WPID" >/dev/null 2>&1; for _ in $(seq 1 6); do [ -z "$(port_pid)" ] && { freed=1; break; }; sleep 1; done; fi
[ "$freed" = "1" ] && ok "puerto $PORT liberado (sin zombies)" || bad "puerto sigue tomado"

echo ""; echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ] && echo "✅ e2e DynamoDB (launcher + A2) OK" || echo "❌ e2e DynamoDB con fallos"
[ "$FAIL" -eq 0 ]
