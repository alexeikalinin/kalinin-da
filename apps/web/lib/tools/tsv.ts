// Generic TSV parser — Yandex Direct's Reports API is the only current
// caller (yandex-direct.ts's getCampaignReport), but this is a plain
// format parser, not Direct-specific logic, so it lives on its own.
export function parseTsv(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(header.map((key, i) => [key, values[i] ?? ""]));
  });
}
