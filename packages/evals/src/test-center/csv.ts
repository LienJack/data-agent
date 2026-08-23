export interface ParsedCsv {
  readonly headers: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
}

/** Small RFC 4180 parser used only for pinned benchmark CSV artifacts. */
export function parseBenchmarkCsv(input: string): ParsedCsv {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    if (record.some((value) => value.length > 0)) records.push(record);
    record = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? "";
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      pushField();
    } else if (character === "\n") {
      pushRecord();
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (quoted) throw new Error("BENCHMARK_CSV_UNTERMINATED_QUOTE");
  if (field.length > 0 || record.length > 0) pushRecord();
  const headers = records.shift()?.map((value) => value.trim()) ?? [];
  if (headers.length === 0 || headers.some((header) => header.length === 0)) {
    throw new Error("BENCHMARK_CSV_HEADER_INVALID");
  }
  if (new Set(headers).size !== headers.length || headers.length > 256) {
    throw new Error("BENCHMARK_CSV_HEADER_INVALID");
  }
  if (records.length === 0 || records.length > 100_000) {
    throw new Error("BENCHMARK_CSV_ROW_COUNT_INVALID");
  }
  const rows = records.map((values) => {
    if (values.length !== headers.length) throw new Error("BENCHMARK_CSV_WIDTH_MISMATCH");
    return Object.freeze(
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    );
  });
  return Object.freeze({ headers: Object.freeze(headers), rows: Object.freeze(rows) });
}
