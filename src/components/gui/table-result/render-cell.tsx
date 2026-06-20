import BlobCell from "@/components/gui/table-cell/blob-cell";
import { DatabaseValue } from "@/drivers/base-driver";
import parseSafeJson from "@/lib/json-safe";
import { deserializeV8 } from "@/lib/v8-derialization";
import { ColumnType } from "@outerbase/sdk-transform";
import { useMemo } from "react";
import BigNumberCell from "../table-cell/big-number-cell";
import GenericCell from "../table-cell/generic-cell";
import NumberCell from "../table-cell/number-cell";
import TextCell from "../table-cell/text-cell";
import { OptimizeTableCellRenderProps } from "../table-optimized";
import { TableHeaderMetadata } from "./type";

function detectTextEditorType(
  value: DatabaseValue<string>
): "input" | "json" | "text" {
  if (typeof value !== "string") return "input";

  // Check if it is JSON format
  const trimmedText = value.trim();
  if (
    trimmedText.substring(0, 1) === "{" &&
    trimmedText.substring(trimmedText.length - 1) === "}"
  ) {
    if (parseSafeJson(trimmedText, undefined) !== undefined) return "json";
  }

  // Check if it is long string
  if (value.length > 200) return "text";

  // If it is multiple line
  if (value.search(/[\n\r]/) >= 0) return "text";

  return "input";
}

function determineCellType(value: unknown) {
  if (value === null) return undefined;
  if (typeof value === "bigint") return ColumnType.INTEGER;
  if (typeof value === "number") return ColumnType.REAL;
  if (typeof value === "string") return ColumnType.TEXT;
  if (typeof value === "object") return ColumnType.BLOB;

  return undefined;
}

/**
 * Formatea un valor DynamoDB no-escalar (Map/List/Set/Binary) a un string
 * legible para la grilla. Los items ya vienen unmarshalled por el DocumentClient,
 * así que:
 *  - M  → objeto JS plano → JSON
 *  - L  → array JS → JSON
 *  - SS → Set<string> (o array) de strings
 *  - NS → Set/array de números
 *  - BS → Set/array de binarios → conteo
 *  - B  → Uint8Array/ArrayBuffer → base64 corto
 */
// Tope de caracteres que generamos para una celda. La grilla solo muestra una
// línea con ellipsis, así que serializar megabytes es puro desperdicio: se hace
// de forma SÍNCRONA en el render de CADA celda visible y se REPITE en cada
// re-render (scroll, focus, resize). Un único documento/binario grande de
// DynamoDB (Map/List/Binary anidado, hasta 400 KB por item) multiplicado por
// las celdas visibles y los re-renders clava el main thread → "freeze" sin log.
// Con este tope el costo por celda es O(1) respecto al tamaño del valor.
const DYNAMO_CELL_MAX_CHARS = 4096;

// Binario: cuenta los bytes a partir de la forma REAL que llega del proxy.
// El DocumentClient marshalla B como Uint8Array, pero el round-trip JSON del
// proxy (NextResponse.json → response.json) lo convierte en un objeto plano
// { "0": .., "1": .. }. Por eso solo informamos el tamaño, sin recorrer bytes.
function dynamoBinarySummary(v: unknown): string {
  let length: number | undefined;
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
    length = (v as Uint8Array).byteLength ?? (v as Uint8Array).length;
  } else if (Array.isArray(v)) {
    length = v.length;
  } else if (v && typeof v === "object") {
    // objeto plano con claves numéricas (binario tras el round-trip del proxy)
    length = Object.keys(v).length;
  }
  return length === undefined ? "[binary]" : `{ ${length} bytes }`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function formatDynamoComplexValue(value: unknown, dynamoType?: string): string {
  // Sets: el DocumentClient los entrega como Set<...>; los normalizamos a array.
  const toArray = (v: unknown): unknown[] => {
    if (v instanceof Set) return Array.from(v);
    if (Array.isArray(v)) return v;
    return [v];
  };

  let out: string;
  try {
    switch (dynamoType) {
      case "B":
      case "BS":
        // Nunca serializamos binarios completos: solo un resumen de tamaño.
        return dynamoBinarySummary(value);
      case "SS":
        out = safeStringify(toArray(value));
        break;
      case "NS":
        out = safeStringify(toArray(value).map((n) => Number(n)));
        break;
      case "M":
      case "L":
      default:
        // Map/List (o fallback): JSON. value ya es objeto/array JS plano.
        out = safeStringify(value);
        break;
    }
  } catch {
    out = String(value);
  }

  // Tope duro: una celda nunca muestra (ni procesa para mostrar) megabytes.
  return out.length > DYNAMO_CELL_MAX_CHARS
    ? out.slice(0, DYNAMO_CELL_MAX_CHARS) + "…"
    : out;
}

function CloudflareKvValue({
  props,
}: {
  props: OptimizeTableCellRenderProps<TableHeaderMetadata>;
}) {
  const { y, x, state, header, isFocus } = props;

  const value = useMemo(() => {
    const rawBuffer = state.getValue(y, x);
    let buffer = new ArrayBuffer();

    if (rawBuffer instanceof ArrayBuffer) {
      buffer = rawBuffer;
    } else if (rawBuffer instanceof Uint8Array) {
      buffer = rawBuffer.buffer as ArrayBuffer;
    } else if (rawBuffer instanceof Array) {
      buffer = new Uint8Array(rawBuffer).buffer;
    }

    return deserializeV8(buffer);
  }, [y, x, state]);

  let displayValue: string | null = "";

  if (value.value !== undefined) {
    if (typeof value.value === "string") {
      displayValue = value.value;
    } else if (value.value === null) {
      displayValue = null;
    } else if (typeof value.value === "object") {
      // Protect from circular references
      try {
        displayValue = JSON.stringify(value.value, null);
      } catch (e) {
        if (e instanceof Error) {
          value.error = e.message;
        } else {
          value.error = String(e);
        }
      }
    } else {
      displayValue = String(value.value);
    }
  }

  if (value.error) {
    return (
      <div className="h-[35px] px-2 font-mono leading-[35px] text-red-500!">
        Error: {value.error}
      </div>
    );
  }

  return (
    <TextCell
      header={header}
      state={state}
      editor={detectTextEditorType(displayValue)}
      editMode={false}
      value={displayValue}
      valueType={ColumnType.TEXT}
      focus={isFocus}
      onChange={(newValue) => {
        state.changeValue(y, x, newValue);
      }}
    />
  );
}

// DynamoDB: atributos complejos (Map/List/Set/Binary). Es un COMPONENTE (no JSX
// inline en el renderer) para poder memoizar `formatDynamoComplexValue` con
// useMemo: el renderer de celda se re-ejecuta en cada re-render de la grilla
// (scroll, focus, resize), y sin memo re-serializaríamos el valor cada vez.
function DynamoComplexValue({
  props,
}: {
  props: OptimizeTableCellRenderProps<TableHeaderMetadata>;
}) {
  const { y, x, state, header, isFocus } = props;

  const display = useMemo(
    () => formatDynamoComplexValue(state.getValue(y, x), header.metadata.dynamoType),
    [y, x, state, header.metadata.dynamoType]
  );

  return (
    <TextCell
      header={header}
      state={state}
      editor={detectTextEditorType(display)}
      editMode={false}
      value={display}
      valueType={ColumnType.TEXT}
      focus={isFocus}
      onChange={() => {
        /* read-only en Wave 2: M/L/sets no son editables todavía */
      }}
    />
  );
}

export default function tableResultCellRenderer(
  props: OptimizeTableCellRenderProps<TableHeaderMetadata>
) {
  const { y, x, state, header, isFocus } = props;

  const editMode = isFocus && state.isInEditMode();
  const value = state.getValue(y, x);

  const valueType = determineCellType(value);

  // Check if it is Cloudflare KV type
  if (
    header.metadata?.from?.table === "_cf_KV" &&
    header.metadata?.from?.column === "value"
  ) {
    return <CloudflareKvValue props={props} />;
  }

  // DynamoDB: atributos complejos (Map/List/Set/Binary) se renderizan como
  // JSON/representación legible en vez de caer en BlobCell (que mostraría basura
  // al hacer Uint8Array.from sobre un objeto). Los escalares (S/N/BOOL/NULL)
  // siguen el path normal de abajo.
  if (
    header.metadata.isDynamoAttribute &&
    value !== null &&
    value !== undefined &&
    typeof value === "object"
  ) {
    return <DynamoComplexValue props={props} />;
  }

  switch (valueType ?? header.metadata.type) {
    case ColumnType.INTEGER:
      return (
        <BigNumberCell
          header={header}
          state={state}
          editMode={editMode}
          value={value as DatabaseValue<bigint>}
          valueType={valueType}
          focus={isFocus}
          onChange={(newValue) => {
            state.changeValue(y, x, newValue);
          }}
        />
      );

    case ColumnType.REAL:
      return (
        <NumberCell
          header={header}
          state={state}
          editMode={editMode}
          value={value as DatabaseValue<number>}
          valueType={valueType}
          focus={isFocus}
          onChange={(newValue) => {
            state.changeValue(y, x, newValue);
          }}
        />
      );

    case ColumnType.TEXT:
      return (
        <TextCell
          header={header}
          state={state}
          editor={detectTextEditorType(value as DatabaseValue<string>)}
          editMode={editMode}
          value={value as DatabaseValue<string>}
          valueType={valueType}
          focus={isFocus}
          onChange={(newValue) => {
            state.changeValue(y, x, newValue);
          }}
        />
      );

    case ColumnType.BLOB:
      return (
        <BlobCell
          header={header}
          state={state}
          editMode={editMode}
          valueType={valueType}
          value={value as DatabaseValue<number[]>}
          focus={isFocus}
          onChange={(newValue) => {
            state.changeValue(y, x, newValue);
          }}
        />
      );

    default:
      return <GenericCell value={value as string} header={header} />;
  }
}
