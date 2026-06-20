import { SQLDialect } from "@codemirror/lang-sql";

// Keywords de PartiQL — superconjunto de SQL básico con extensiones de DynamoDB.
// Referencia: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ql-reference.html
const partiqlKeywords =
  "SELECT FROM WHERE INSERT INTO VALUE VALUES UPDATE SET REMOVE DELETE AND OR NOT IN BETWEEN IS MISSING NULL TRUE FALSE EXISTS CONTAINS BEGINS_WITH ATTRIBUTE_TYPE SIZE ORDER BY ASC DESC LIMIT AS AT BY HAVING GROUP UNION ALL DISTINCT PIVOT UNPIVOT CROSS JOIN INNER LEFT OUTER FULL ON USING TUPLE LIST STRUCT BAG CAST COUNT MIN MAX SUM AVG";

// Tipos de datos que maneja DynamoDB / PartiQL
const partiqlTypes =
  "string number binary boolean null list map set null_set";

export const partiqlDialect = SQLDialect.define({
  keywords: partiqlKeywords,
  types: partiqlTypes,
  // PartiQL usa comillas dobles para identificadores y simples para strings (igual que SQL estándar)
  identifierQuotes: '"',
  operatorChars: "*+-%<>!=&|/~",
  // No tiene variables especiales al estilo SQLite (@:?$)
  specialVar: "",
});
