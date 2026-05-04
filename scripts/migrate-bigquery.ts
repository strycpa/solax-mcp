import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const projectId = requiredEnv("BIGQUERY_PROJECT_ID");
const datasetId = requiredEnv("BIGQUERY_DATASET_ID");
const location = requiredEnv("BIGQUERY_LOCATION");
const migrationsDir = path.resolve("bigquery/migrations");
const migrationsTable = `\`${projectId}.${datasetId}.schema_migrations\``;

interface MigrationFile {
  version: string;
  filename: string;
  path: string;
  sql: string;
  checksum: string;
}

interface AppliedMigration {
  version: string;
  filename: string;
  checksum: string;
}

async function main(): Promise<void> {
  const migrations = await readMigrationFiles();

  if (migrations.length === 0) {
    console.log("No BigQuery migrations found.");
    return;
  }

  await ensureMigrationsTable();
  const appliedMigrations = await readAppliedMigrations();
  validateAppliedMigrations(migrations, appliedMigrations);

  const appliedVersions = new Set(
    appliedMigrations.map((migration) => migration.version),
  );
  const pendingMigrations = migrations.filter(
    (migration) => !appliedVersions.has(migration.version),
  );

  if (pendingMigrations.length === 0) {
    console.log("BigQuery migrations are up to date.");
    return;
  }

  for (const migration of pendingMigrations) {
    console.log(`Applying BigQuery migration ${migration.filename}`);
    await runQuery(migration.sql);
    await recordAppliedMigration(migration);
  }
}

async function readMigrationFiles(): Promise<MigrationFile[]> {
  const filenames = (await readdir(migrationsDir))
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    filenames.map(async (filename) => {
      const filePath = path.join(migrationsDir, filename);
      const sql = await readFile(filePath, "utf8");

      return {
        version: filename.split("_", 1)[0] ?? filename,
        filename,
        path: filePath,
        sql,
        checksum: checksum(sql),
      };
    }),
  );
}

async function ensureMigrationsTable(): Promise<void> {
  await runQuery(`
CREATE SCHEMA IF NOT EXISTS \`${projectId}.${datasetId}\`
OPTIONS (
  location = "${location}",
  description = "SolaX PV historical measurements"
);

CREATE TABLE IF NOT EXISTS ${migrationsTable}
(
  version STRING NOT NULL,
  filename STRING NOT NULL,
  checksum STRING NOT NULL,
  applied_at TIMESTAMP NOT NULL
)
OPTIONS (
  description = "Applied BigQuery schema migrations"
);
`);
}

async function readAppliedMigrations(): Promise<AppliedMigration[]> {
  const query = `
SELECT version, filename, checksum
FROM ${migrationsTable}
ORDER BY version
`;
  const output = await runBq([
    "query",
    "--use_legacy_sql=false",
    "--format=json",
    query,
  ]);
  const parsed: unknown = JSON.parse(output);

  if (!Array.isArray(parsed)) {
    throw new Error("Unexpected BigQuery migration query output.");
  }

  return parsed.map((row) => parseAppliedMigration(row));
}

function validateAppliedMigrations(
  migrations: readonly MigrationFile[],
  appliedMigrations: readonly AppliedMigration[],
): void {
  const migrationsByVersion = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );

  for (const appliedMigration of appliedMigrations) {
    const migration = migrationsByVersion.get(appliedMigration.version);

    if (migration === undefined) {
      throw new Error(
        `Applied BigQuery migration ${appliedMigration.version} is missing from ${migrationsDir}.`,
      );
    }

    if (migration.filename !== appliedMigration.filename) {
      throw new Error(
        `Applied BigQuery migration ${appliedMigration.version} filename changed from ${appliedMigration.filename} to ${migration.filename}.`,
      );
    }

    if (migration.checksum !== appliedMigration.checksum) {
      throw new Error(
        `Applied BigQuery migration ${migration.filename} checksum changed. Revert the file or create a new migration.`,
      );
    }
  }
}

async function recordAppliedMigration(migration: MigrationFile): Promise<void> {
  await runQuery(
    `
INSERT INTO ${migrationsTable} (version, filename, checksum, applied_at)
VALUES (@version, @filename, @checksum, CURRENT_TIMESTAMP())
`,
    [
      `--parameter=version:STRING:${migration.version}`,
      `--parameter=filename:STRING:${migration.filename}`,
      `--parameter=checksum:STRING:${migration.checksum}`,
    ],
  );
}

async function runQuery(sql: string, args: readonly string[] = []): Promise<void> {
  await runBq(["query", "--use_legacy_sql=false", ...args, sql]);
}

async function runBq(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("bq", ["--location", location, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout;
}

function parseAppliedMigration(row: unknown): AppliedMigration {
  if (
    typeof row !== "object" ||
    row === null ||
    !("version" in row) ||
    !("filename" in row) ||
    !("checksum" in row)
  ) {
    throw new Error("Unexpected BigQuery migration row shape.");
  }

  const { version, filename, checksum: rowChecksum } = row;

  if (
    typeof version !== "string" ||
    typeof filename !== "string" ||
    typeof rowChecksum !== "string"
  ) {
    throw new Error("Unexpected BigQuery migration row field type.");
  }

  return {
    version,
    filename,
    checksum: rowChecksum,
  };
}

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
