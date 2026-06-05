import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureOutputDir(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
}

export async function writeJsonReport<T extends { module: string }>(
  outputDir: string,
  report: T,
): Promise<string> {
  await ensureOutputDir(outputDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${report.module}-${timestamp}.json`;
  const filepath = path.join(outputDir, filename);
  await writeFile(filepath, JSON.stringify(report, null, 2), "utf-8");
  return filepath;
}

export async function writeMarkdownReport(
  outputDir: string,
  filename: string,
  content: string,
): Promise<string> {
  await ensureOutputDir(outputDir);
  const filepath = path.join(outputDir, filename);
  await writeFile(filepath, content, "utf-8");
  return filepath;
}

/** Load the most recent JSON report for a given module. */
export async function loadLatestModuleReport<T>(
  outputDir: string,
  moduleName: string,
): Promise<T | null> {
  try {
    const files = await readdir(outputDir);
    const matching = files
      .filter((f) => f.startsWith(`${moduleName}-`) && f.endsWith(".json"))
      .sort()
      .reverse();

    if (matching.length === 0) {
      return null;
    }

    const content = await readFile(path.join(outputDir, matching[0]), "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
