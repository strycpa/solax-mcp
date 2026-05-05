export interface BigQueryTableId {
  projectId: string;
  datasetId: string;
  tableId: string;
}

export interface PreparePvHistoryQueryOptions {
  sql: string;
  tableId: BigQueryTableId;
  maxRows: number;
  defaultLimit: number;
}

export type PreparePvHistoryQueryResult =
  | { ok: true; sql: string }
  | { ok: false; error: string };

const MAX_SQL_LENGTH = 32_000;

const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /;/,
  /`/,
  /--/,
  /\/\*/,
  /\binsert\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\bcreate\b/i,
  /\balter\b/i,
  /\btruncate\b/i,
  /\bmerge\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bexecute\b/i,
  /\bcall\b/i,
  /\bscript\b/i,
  /\bjavascript\b/i,
  /\bexport\s+data\b/i,
  /\bload\s+job\b/i,
  /\bunion\b/i,
  /\bintersect\b/i,
  /\bexcept\b/i,
  /information_schema/i,
  /\bexternal_query\b/i,
];

function quoteFqTable(tableId: BigQueryTableId): string {
  const escape = (segment: string): string =>
    "`" + segment.replace(/`/g, "") + "`";

  return `${escape(tableId.projectId)}.${escape(tableId.datasetId)}.${escape(tableId.tableId)}`;
}

function replacePvSamplesTable(sql: string, fqQuoted: string): string {
  return sql.replace(/\bpv_samples\b/gi, fqQuoted);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function enforceLimitClause(
  sql: string,
  maxRows: number,
  defaultLimit: number,
): string {
  const limitMatch = /\blimit\s+(\d+)(\s+offset\s+\d+)?\s*$/i.exec(sql);

  if (limitMatch === null) {
    const cap = Math.min(defaultLimit, maxRows);
    return `${sql}\nLIMIT ${cap}`;
  }

  const requested = Number.parseInt(limitMatch[1] ?? "", 10);

  if (!Number.isFinite(requested) || requested < 1) {
    const cap = Math.min(defaultLimit, maxRows);
    const offsetSuffix = limitMatch[2] ?? "";
    return `${sql.slice(0, limitMatch.index).trimEnd()}\nLIMIT ${cap}${offsetSuffix}`;
  }

  const capped = Math.min(requested, maxRows);
  const offsetSuffix = limitMatch[2] ?? "";
  return `${sql.slice(0, limitMatch.index).trimEnd()}\nLIMIT ${capped}${offsetSuffix}`;
}

function normalizeTypicalPvHistoryTypos(sql: string): string {
  return sql.replace(/\bbattery_soc\b/gi, "battery_soc_percent");
}

export function preparePvHistorySelectQuery(
  options: PreparePvHistoryQueryOptions,
): PreparePvHistoryQueryResult {
  const trimmed = normalizeTypicalPvHistoryTypos(options.sql.trim());

  if (trimmed.length === 0) {
    return { ok: false, error: "SQL query is empty." };
  }

  if (trimmed.length > MAX_SQL_LENGTH) {
    return {
      ok: false,
      error: `SQL query exceeds maximum length (${MAX_SQL_LENGTH} characters).`,
    };
  }

  if (!/^\s*select\b/is.test(trimmed)) {
    return {
      ok: false,
      error: 'Only SELECT queries are allowed and must start with "SELECT".',
    };
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        ok: false,
        error:
          "Query contains forbidden syntax (comments, semicolons, backticks, UNION, DDL/DML, or other blocked constructs). Use plain identifiers and write one SELECT only.",
      };
    }
  }

  if (!/\bpv_samples\b/i.test(trimmed)) {
    return {
      ok: false,
      error:
        'Reference the PV samples table exactly as pv_samples (for example FROM pv_samples).',
    };
  }

  const fqQuoted = quoteFqTable(options.tableId);
  const rewritten = replacePvSamplesTable(trimmed, fqQuoted);
  const rewrittenWithoutInjectedTable = rewritten.replace(
    new RegExp(escapeRegExp(fqQuoted), "g"),
    "",
  );

  if (/\bpv_samples\b/i.test(rewrittenWithoutInjectedTable)) {
    return {
      ok: false,
      error:
        "After rewriting table references, pv_samples remained — check your SQL.",
    };
  }

  if (!/\bsampled_date\b/i.test(rewritten)) {
    return {
      ok: false,
      error:
        "Partitioned table requires a predicate on sampled_date (for example WHERE sampled_date BETWEEN DATE('2026-05-01') AND DATE('2026-05-04')). Include sampled_date explicitly.",
    };
  }

  const limited = enforceLimitClause(
    rewritten,
    options.maxRows,
    options.defaultLimit,
  );

  return { ok: true, sql: limited };
}
