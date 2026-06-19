import { useStudioContext } from "@/context/driver-provider";
import {
  DatabaseTableSchema,
  DatabaseTableSchemaChange,
} from "@/drivers/base-driver";
import { generateId } from "@/lib/generate-id";
import { checkSchemaChange } from "@/lib/sql/sql-generate.schema";
import {
  LucideCode,
  LucideCopy,
  LucideKeyRound,
  LucideList,
  LucidePencil,
  LucidePlus,
  LucideSave,
} from "lucide-react";
import { Dispatch, SetStateAction, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "../../ui/button";
import { Input } from "../../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { Separator } from "../../ui/separator";
import CodePreview from "../code-preview";
import { ColumnsProvider } from "./column-provider";
import SchemaEditorColumnList from "./schema-editor-column-list";
import SchemaEditorConstraintList from "./schema-editor-constraint-list";
import SchemaNameSelect from "./schema-name-select";

interface Props {
  onSave: () => void;
  onDiscard: () => void;
  value: DatabaseTableSchemaChange;
  onChange: Dispatch<SetStateAction<DatabaseTableSchemaChange>>;
  /** Original introspected schema (read-only metadata: comment, indexes, ...). */
  introspection?: DatabaseTableSchema;
  /** Modo "Ver": sin edición, con botón para pasar a edición. */
  readOnly?: boolean;
  onEdit?: () => void;
}

export default function SchemaEditor({
  value,
  onChange,
  onSave,
  onDiscard,
  introspection,
  readOnly,
  onEdit,
}: Readonly<Props>) {
  const { databaseDriver } = useStudioContext();
  const isCreateScript = value.name.old === "";

  const onAddColumn = useCallback(() => {
    const newColumn =
      value.columns.length === 0
        ? {
            name: "id",
            type: databaseDriver.columnTypeSelector.idTypeName ?? "INTEGER",
            constraint: {
              primaryKey: true,
            },
          }
        : {
            name: "column",
            type: databaseDriver.columnTypeSelector.textTypeName ?? "TEXT",
            constraint: {},
          };

    onChange({
      ...value,
      columns: [
        ...value.columns,
        {
          key: generateId(),
          old: null,
          new: newColumn,
        },
      ],
    });
  }, [value, onChange, databaseDriver]);

  const hasChange = checkSchemaChange(value);

  const previewScript = useMemo(() => {
    return databaseDriver.createUpdateTableSchema(value).join(";\n");
  }, [value, databaseDriver]);

  const editorOptions = useMemo(() => {
    return {
      collations: databaseDriver.getCollationList(),
    };
  }, [databaseDriver]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="shrink-0 grow-0">
        <div className="flex gap-2 p-1">
          {readOnly ? (
            // Modo "Ver": sin guardar/descartar/agregar, solo pasar a edición.
            <Button variant="ghost" onClick={onEdit} size={"sm"}>
              <LucidePencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={onSave}
                disabled={!hasChange || !value.name?.new || !value.schemaName}
                size={"sm"}
              >
                <LucideSave className="mr-2 h-4 w-4" />
                Save
              </Button>
              <Button
                size={"sm"}
                variant="ghost"
                onClick={onDiscard}
                disabled={!hasChange}
                className="text-red-500"
              >
                Discard Change
              </Button>

              <div>
                <Separator orientation="vertical" />
              </div>

              <Button variant="ghost" onClick={onAddColumn} size={"sm"}>
                <LucidePlus className="mr-1 h-4 w-4" />
                Add Column
              </Button>
            </>
          )}

          <div>
            <Separator orientation="vertical" />
          </div>

          <Popover>
            <PopoverTrigger>
              <div className={buttonVariants({ size: "sm", variant: "ghost" })}>
                <LucideCode className="mr-1 h-4 w-4" />
                SQL Preview
              </div>
            </PopoverTrigger>
            <PopoverContent style={{ width: 500 }}>
              <div className="mb-1 text-xs font-semibold">SQL Preview</div>
              <div style={{ maxHeight: 400 }} className="overflow-y-auto">
                <CodePreview code={previewScript} />
              </div>
            </PopoverContent>
          </Popover>

          {value.createScript && (
            <Popover>
              <PopoverTrigger>
                <div
                  className={buttonVariants({ size: "sm", variant: "ghost" })}
                >
                  <LucideCode className="mr-1 h-4 w-4" />
                  Create Script
                </div>
              </PopoverTrigger>
              <PopoverContent style={{ width: 500 }}>
                <Button
                  variant={"outline"}
                  size="sm"
                  onClick={() => {
                    toast.success("Copied create script successfully");
                    window.navigator.clipboard.writeText(
                      value.createScript ?? ""
                    );
                  }}
                >
                  <LucideCopy className="mr-2 h-4 w-4" />
                  Copy
                </Button>
                <div
                  style={{ maxHeight: 400 }}
                  className="mt-2 overflow-y-auto"
                >
                  <CodePreview code={value.createScript} />
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        <div className="mx-3 mt-3 mb-4 ml-5 flex items-center gap-2">
          <div>
            <div className="mb-1 text-xs font-medium">Table Name</div>
            <Input
              placeholder="Table Name"
              value={value.name.new ?? value.name.old ?? ""}
              disabled={readOnly}
              onChange={(e) => {
                onChange({
                  ...value,
                  name: {
                    ...value.name,
                    new: e.currentTarget.value,
                  },
                });
              }}
              className="w-[200px]"
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium">Schema</div>
            <SchemaNameSelect
              readonly={!isCreateScript}
              value={value.schemaName}
              onChange={(selectedSchema) => {
                onChange({ ...value, schemaName: selectedSchema });
              }}
            />
          </div>
        </div>

        {introspection?.comment && (
          <div className="mx-3 mb-4 ml-5 max-w-3xl text-sm whitespace-pre-wrap text-muted-foreground">
            {introspection.comment}
          </div>
        )}

        <Separator />
      </div>
      <div className="grow overflow-y-auto">
        <SchemaEditorColumnList
          columns={value.columns}
          onChange={onChange}
          onAddColumn={onAddColumn}
          schemaName={value.schemaName}
          options={editorOptions}
          readOnly={readOnly}
          disabledEditExistingColumn={
            readOnly || !databaseDriver.getFlags().supportModifyColumn
          }
        />
        <ColumnsProvider value={value.columns}>
          <SchemaEditorConstraintList
            schemaName={value.schemaName}
            constraints={value.constraints}
            onChange={onChange}
            disabled={readOnly || !isCreateScript}
          />
        </ColumnsProvider>

        {introspection?.indexes && introspection.indexes.length > 0 && (
          <div className="px-4 py-2">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <LucideList className="h-4 w-4" />
              Indexes
            </div>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="border bg-secondary p-2 text-left text-xs">
                    Name
                  </th>
                  <th className="border bg-secondary p-2 text-left text-xs">
                    Columns
                  </th>
                  <th className="w-[120px] border bg-secondary p-2 text-left text-xs">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody>
                {introspection.indexes.map((index) => (
                  <tr key={index.name} className="text-sm">
                    <td className="border p-2 font-mono">
                      <div className="flex items-center gap-2">
                        {index.primary && (
                          <LucideKeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {index.name}
                      </div>
                    </td>
                    <td className="border p-2 font-mono">
                      {index.columns.join(", ")}
                    </td>
                    <td className="border p-2 text-muted-foreground">
                      {index.primary
                        ? "PRIMARY"
                        : index.unique
                          ? "UNIQUE"
                          : "INDEX"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
