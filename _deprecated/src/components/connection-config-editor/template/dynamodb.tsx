import { ConnectionTemplateList } from "@/app/(outerbase)/base-template";
import { CommonConnectionConfigTemplate } from "..";

const template: CommonConnectionConfigTemplate = [
  {
    columns: [
      {
        name: "awsAccessKeyId",
        label: "AWS Access Key ID",
        type: "text",
        required: true,
        placeholder: "AKIAIOSFODNN7EXAMPLE",
      },
    ],
  },
  {
    columns: [
      {
        name: "awsSecretAccessKey",
        label: "AWS Secret Access Key",
        type: "password",
        required: true,
        placeholder: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
    ],
  },
  {
    columns: [
      {
        name: "awsRegion",
        label: "AWS Region",
        type: "text",
        required: true,
        placeholder: "us-east-1",
      },
    ],
  },
  {
    columns: [
      {
        name: "awsEndpoint",
        label: "Endpoint (opcional — DynamoDB Local)",
        type: "text",
        required: false,
        placeholder: "http://localhost:8000",
      },
    ],
  },
];

const instruction = (
  <div className="bg-secondary m-4 flex flex-col gap-4 rounded-lg border p-4 text-base leading-7 shadow">
    <h2 className="text-lg font-bold">Conectarse a Amazon DynamoDB</h2>
    <p>
      Necesitás credenciales IAM con permisos sobre DynamoDB. Lo mínimo
      recomendado es la policy <strong>AmazonDynamoDBReadOnlyAccess</strong>; si
      querés escritura agregá <strong>AmazonDynamoDBFullAccess</strong> (o una
      policy custom más restrictiva).
    </p>

    <ul className="ml-8 list-disc">
      <li>
        Entrá a IAM en la consola AWS y creá un usuario con acceso programático.
      </li>
      <li>
        Copiá el <em>Access Key ID</em> y el <em>Secret Access Key</em> que te
        muestra al crear el usuario (solo se muestran una vez).
      </li>
      <li>
        La región tiene que coincidir con donde están tus tablas (ej:{" "}
        <span className="bg-background p-1 px-2 font-mono">us-east-1</span>).
      </li>
    </ul>

    <h2 className="text-lg font-bold">DynamoDB Local</h2>
    <p>
      Si estás usando DynamoDB Local para desarrollo, completá el campo{" "}
      <strong>Endpoint</strong> con la URL del proceso local, por ejemplo:
    </p>
    <span className="bg-background p-1 px-2 font-mono">
      http://localhost:8000
    </span>
    <p>
      Podés levantar DynamoDB Local con Docker:
      <br />
      <span className="bg-background p-1 px-2 font-mono">
        docker run -p 8000:8000 amazon/dynamodb-local
      </span>
    </p>
  </div>
);

export const DynamoDBConnectionTemplate: ConnectionTemplateList = {
  template,
  instruction,
  localFrom: (value) => {
    return {
      name: value.name,
      awsAccessKeyId: value.awsAccessKeyId,
      awsSecretAccessKey: value.awsSecretAccessKey,
      awsRegion: value.awsRegion,
      awsEndpoint: value.awsEndpoint,
    };
  },
  localTo: (value) => {
    return {
      name: value.name,
      driver: "dynamodb",
      awsAccessKeyId: value.awsAccessKeyId,
      awsSecretAccessKey: value.awsSecretAccessKey,
      awsRegion: value.awsRegion,
      awsEndpoint: value.awsEndpoint,
    };
  },
};
