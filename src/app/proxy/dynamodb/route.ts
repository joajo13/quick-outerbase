import { HttpStatus } from "@/constants/http-status";
// Control plane (sin marshalling): operan sobre metadata de tablas.
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
  UpdateTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
// Data plane: los Commands de lib-dynamodb (DocumentClient) auto-(un)marshallan
// entre objetos JS planos y el formato AttributeValue ({S}/{N}/{M}/...). Si se
// usaran los Commands de client-dynamodb, los items volverían marshalled crudos.
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
  TransactWriteCommand,
  ExecuteStatementCommand,
} from "@aws-sdk/lib-dynamodb";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

// Node runtime obligatorio — el SDK de AWS usa crypto de Node para firmar SigV4
export const runtime = "nodejs";

// Mapa de action string → clase Command del SDK
// Wave 0: todos registrados, Wave 1+ los usará con params reales.
// Cada Command tiene su propio Input tipado (TableName/Key/etc.), incompatibles
// entre sí; tiparlos con un constructor genérico exige `any` acá.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COMMAND_MAP: Record<string, new (params: any) => any> = {
  // Control plane (client-dynamodb): metadata, sin (un)marshalling.
  ListTables: ListTablesCommand,
  DescribeTable: DescribeTableCommand,
  CreateTable: CreateTableCommand,
  DeleteTable: DeleteTableCommand,
  UpdateTable: UpdateTableCommand,
  // Data plane (lib-dynamodb / DocumentClient): auto-(un)marshalling de items.
  Scan: ScanCommand,
  Query: QueryCommand,
  GetItem: GetCommand,
  PutItem: PutCommand,
  UpdateItem: UpdateCommand,
  DeleteItem: DeleteCommand,
  BatchWriteItem: BatchWriteCommand,
  ExecuteStatement: ExecuteStatementCommand,
  TransactWriteItems: TransactWriteCommand,
};

// Redacta cualquier credencial que pueda colarse en mensajes de error
function redactCredentials(message: string, accessKeyId: string): string {
  return message
    .replace(new RegExp(accessKeyId, "g"), "[REDACTED_KEY_ID]")
    .replace(/(?:secret|SecretAccessKey)[^"]*"[^"]{8,}"/gi, '"[REDACTED_SECRET]"');
}

export async function POST(req: NextRequest) {
  const headerStore = await headers();

  // Las credenciales viajan en headers (igual que d1 manda el token en Authorization)
  const accessKeyId = headerStore.get("x-aws-access-key-id");
  const secretAccessKey = headerStore.get("x-aws-secret-access-key");
  const region = headerStore.get("x-aws-region");
  const endpoint = headerStore.get("x-aws-endpoint") ?? undefined;

  if (!accessKeyId || !secretAccessKey || !region) {
    return NextResponse.json(
      {
        error:
          "Faltan credenciales AWS. Enviá los headers: x-aws-access-key-id, x-aws-secret-access-key, x-aws-region",
      },
      { status: HttpStatus.BAD_REQUEST }
    );
  }

  let body: { action: string; params: object };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body inválido: se esperaba JSON con { action, params }" },
      { status: HttpStatus.BAD_REQUEST }
    );
  }

  const { action, params } = body;

  if (!action || typeof action !== "string") {
    return NextResponse.json(
      { error: "Campo 'action' requerido (string)" },
      { status: HttpStatus.BAD_REQUEST }
    );
  }

  const CommandClass = COMMAND_MAP[action];
  if (!CommandClass) {
    return NextResponse.json(
      { error: `Acción desconocida: ${action}. Acciones válidas: ${Object.keys(COMMAND_MAP).join(", ")}` },
      { status: HttpStatus.BAD_REQUEST }
    );
  }

  try {
    const client = new DynamoDBClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint } : {}),
    });

    // DocumentClient auto-unmarshalla los items (no hay que llamar unmarshall a mano)
    const docClient = DynamoDBDocumentClient.from(client);

    const command = new CommandClass(params ?? {});
    const result = await docClient.send(command);

    // Sacamos $metadata para no exponer internals de la respuesta HTTP del SDK
    const { $metadata, ...data } = result as Record<string, unknown>;
    void $metadata;

    return NextResponse.json({ result: data });
  } catch (e) {
    const rawMessage = (e as Error).message ?? String(e);
    const safeMessage = redactCredentials(rawMessage, accessKeyId);

    return NextResponse.json(
      { error: safeMessage },
      { status: HttpStatus.INTERNAL_SERVER_ERROR }
    );
  }
}
