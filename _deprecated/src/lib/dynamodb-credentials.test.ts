import {
  resolveDynamoClientConfig,
  DynamoCredentialsError,
} from "./dynamodb-credentials";

describe("resolveDynamoClientConfig — resolución de creds server-side", () => {
  const noEnv = {};

  test("modo headers (local-first): access key + secret → credenciales explícitas", () => {
    const r = resolveDynamoClientConfig(
      {
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "shhh",
        region: "us-east-1",
      },
      noEnv
    );
    expect(r.region).toBe("us-east-1");
    expect(r.credentials).toEqual({
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "shhh",
    });
  });

  test("modo headers: incluye sessionToken si viene", () => {
    const r = resolveDynamoClientConfig(
      {
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "shhh",
        sessionToken: "tok",
        region: "us-east-1",
      },
      noEnv
    );
    expect(r.credentials?.sessionToken).toBe("tok");
  });

  test("modo env/server: sin creds en headers → NO devuelve credentials (cadena AWS)", () => {
    const r = resolveDynamoClientConfig({ region: "sa-east-1" }, noEnv);
    expect(r.region).toBe("sa-east-1");
    expect(r.credentials).toBeUndefined();
  });

  test("región fallback a AWS_REGION del server si no viene en headers", () => {
    const r = resolveDynamoClientConfig(
      { endpoint: "http://localhost:8000" },
      { AWS_REGION: "eu-west-1" }
    );
    expect(r.region).toBe("eu-west-1");
    expect(r.endpoint).toBe("http://localhost:8000");
    expect(r.credentials).toBeUndefined();
  });

  test("región fallback a AWS_DEFAULT_REGION", () => {
    const r = resolveDynamoClientConfig(
      {},
      { AWS_DEFAULT_REGION: "ap-south-1" }
    );
    expect(r.region).toBe("ap-south-1");
  });

  test("header de región tiene prioridad sobre el env", () => {
    const r = resolveDynamoClientConfig(
      { region: "us-east-2" },
      { AWS_REGION: "eu-west-1" }
    );
    expect(r.region).toBe("us-east-2");
  });

  test("sin región en headers ni env → error claro", () => {
    expect(() => resolveDynamoClientConfig({}, noEnv)).toThrow(
      DynamoCredentialsError
    );
    expect(() => resolveDynamoClientConfig({}, noEnv)).toThrow(/región/i);
  });

  test("solo access key (sin secret) → cae a la cadena por default, sin credentials", () => {
    const r = resolveDynamoClientConfig(
      { accessKeyId: "AKIAEXAMPLE", region: "us-east-1" },
      noEnv
    );
    expect(r.credentials).toBeUndefined();
  });

  test("endpoint fallback a AWS_ENDPOINT_URL_DYNAMODB", () => {
    const r = resolveDynamoClientConfig(
      { region: "us-east-1" },
      { AWS_ENDPOINT_URL_DYNAMODB: "http://localhost:9999" }
    );
    expect(r.endpoint).toBe("http://localhost:9999");
  });

  test("strings vacíos en headers se tratan como ausentes", () => {
    const r = resolveDynamoClientConfig(
      { accessKeyId: "  ", secretAccessKey: "", region: "us-east-1" },
      noEnv
    );
    expect(r.credentials).toBeUndefined();
  });
});
