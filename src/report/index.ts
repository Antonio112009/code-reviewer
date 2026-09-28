import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReportFormat } from '../config/schema';
import type { RunRecord } from '../types';
import { renderCodeQuality } from './codequality';
import { renderHtml } from './html';
import { renderMarkdown } from './markdown';
import { renderSarif } from './sarif';

/** File written for each format by {@link writeReports}. */
export const REPORT_FILE_NAMES: Record<ReportFormat, string> = {
  md: 'report.md',
  json: 'report.json',
  html: 'report.html',
  sarif: 'report.sarif',
  codequality: 'report.codequality.json',
};

/**
 * Renders a run as Markdown, a self-contained interactive HTML page, pretty-printed JSON, SARIF 2.1.0
 * (GitHub code scanning) or a GitLab Code Quality report.
 */
export function renderReport(run: RunRecord, format: ReportFormat): string {
  switch (format) {
    case 'md':
      return renderMarkdown(run);
    case 'html':
      return renderHtml(run);
    case 'json':
      return `${JSON.stringify(run, null, 2)}\n`;
    case 'sarif':
      return renderSarif(run);
    case 'codequality':
      return renderCodeQuality(run);
  }
}

/** Writes one report file per format ({@link REPORT_FILE_NAMES}) into `dir`; returns their paths. */
export async function writeReports(run: RunRecord, formats: ReportFormat[], dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const format of [...new Set(formats)]) {
    const file = path.join(dir, REPORT_FILE_NAMES[format]);
    await writeFile(file, renderReport(run, format));
    files.push(file);
  }
  return files;
}
