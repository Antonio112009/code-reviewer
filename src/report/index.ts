import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReportFormat } from '../config/schema';
import type { RunRecord } from '../types';
import { renderHtml } from './html';
import { renderMarkdown } from './markdown';

/** Renders a run as Markdown, a self-contained interactive HTML page, or pretty-printed JSON. */
export function renderReport(run: RunRecord, format: ReportFormat): string {
  switch (format) {
    case 'md':
      return renderMarkdown(run);
    case 'html':
      return renderHtml(run);
    case 'json':
      return `${JSON.stringify(run, null, 2)}\n`;
  }
}

/** Writes `report.<ext>` files for the given formats into `dir`; returns their paths. */
export async function writeReports(run: RunRecord, formats: ReportFormat[], dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const format of [...new Set(formats)]) {
    const file = path.join(dir, `report.${format}`);
    await writeFile(file, renderReport(run, format));
    files.push(file);
  }
  return files;
}
