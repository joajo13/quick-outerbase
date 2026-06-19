/**
 * Foco de fila entre pestañas: cuando desde el popover de una FK se pide "ir a
 * la tabla", abrimos la tabla referenciada y la filtramos a la fila apuntada por
 * la FK (column = value). Así el foco/scroll ocurre DESDE la vista de la tabla,
 * no en el dialog.
 *
 * Dos mecanismos porque la pestaña puede existir o no al momento del pedido:
 *  - canal en vivo: una tabla YA abierta (y suscripta) recibe el pedido al toque.
 *  - mapa de pendientes: una tabla recién abierta todavía no montó/suscribió
 *    cuando se emitió; lo consume al montar.
 */
import { CommunicationChannel } from "./channel";

export interface TableRowFocusRequest {
  schemaName: string;
  tableName: string;
  column: string;
  value: unknown;
}

export const tableRowFocusChannel =
  new CommunicationChannel<TableRowFocusRequest>();

const pending = new Map<string, TableRowFocusRequest>();
const keyOf = (schemaName: string, tableName: string) =>
  `${schemaName}.${tableName}`;

export function requestTableRowFocus(req: TableRowFocusRequest) {
  // Pendiente para el caso "tab nuevo" + canal para el caso "tab ya abierto".
  pending.set(keyOf(req.schemaName, req.tableName), req);
  tableRowFocusChannel.send(req);
}

export function consumePendingTableRowFocus(
  schemaName: string,
  tableName: string
): TableRowFocusRequest | undefined {
  const k = keyOf(schemaName, tableName);
  const r = pending.get(k);
  if (r) pending.delete(k);
  return r;
}
