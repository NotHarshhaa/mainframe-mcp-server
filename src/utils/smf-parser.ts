/**
 * SMF / RMF metric normalizers.
 */

export interface SmfMetric {
  name: string;
  value: string;
  unit?: string;
}

/** Extract key/value metrics from z/OSMF RMF JSON (shape varies by endpoint). */
export function parseRmfJson(payload: unknown): SmfMetric[] {
  const metrics: SmfMetric[] = [];

  function walk(node: unknown, prefix = ''): void {
    if (node == null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${prefix}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'number' || typeof value === 'string') {
        if (/cpu|mvs|busy|util|rate|count|time|sec|ms|pct|percent/i.test(key)) {
          metrics.push({ name: path, value: String(value) });
        }
      } else {
        walk(value, path);
      }
    }
  }

  walk(payload);
  return metrics.slice(0, 30);
}

/** Parse SMF summary dataset text into metrics (one metric per non-empty line). */
export function parseSmfSummaryText(text: string): SmfMetric[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((line) => {
      const kv = line.match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
      if (kv) return { name: kv[1].trim(), value: kv[2].trim() };
      return { name: 'record', value: line };
    });
}
