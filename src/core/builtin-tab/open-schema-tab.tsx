import SchemaEditorTab from "@/components/gui/tabs/schema-editor-tab";
import { LucideEye, LucideTableProperties } from "lucide-react";
import { createTabExtension } from "../extension-tab";

export const builtinOpenSchemaTab = createTabExtension<
  | {
      schemaName?: string;
      tableName?: string;
      // readOnly: abre el schema en modo "Ver" (inspección), con un botón para
      // pasar a edición. Usa una key/tab distinta a la de "Edit Table".
      readOnly?: boolean;
    }
  | undefined
>({
  name: "schema",
  key: (options) => {
    if (!options?.tableName) {
      return "create";
    }
    const prefix = options.readOnly ? "view-" : "";
    return `${prefix}${options.schemaName}-${options.tableName}`;
  },
  generate: (options) => ({
    title: options?.tableName ? options.tableName : "New Table",
    component: (
      <SchemaEditorTab
        tableName={options?.tableName}
        schemaName={options?.schemaName}
        readOnly={options?.readOnly}
      />
    ),
    icon: options?.readOnly ? LucideEye : LucideTableProperties,
  }),
});
