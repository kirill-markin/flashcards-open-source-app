import { readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep, isAbsolute } from "node:path";

export function requireSeparateOutput(input: string, output: string): void {
  const contains = (parent: string, child: string): boolean => {
    const path = relative(parent, child);
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
  };
  if (contains(input, output) || contains(output, input)) throw new Error(`Input and output directories must be separate: input=${input}; output=${output}. Raw screenshot files are read-only.`);
}

// Check symlinked existing paths as well as their lexical spelling.
export async function requireResolvedSeparation(input: string, output: string): Promise<void> {
  requireSeparateOutput(resolve(input), resolve(output));
  const inputReal = await realpath(input);
  let ancestor = resolve(output);
  const tail: string[] = [];
  while (true) {
    try {
      const actual = await realpath(ancestor);
      requireSeparateOutput(inputReal, resolve(actual, ...tail));
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = resolve(ancestor, "..");
      if (parent === ancestor) throw new Error(`Cannot resolve output directory: ${output}`);
      tail.unshift(relative(parent, ancestor));
      ancestor = parent;
    }
  }
}

export async function previousResults<T extends { path: string; inputRoot: string | null; sourceRevision: string }>(manifestPath: string): Promise<T[]> {
  try {
    const manifest: { inputRoot?: string; sourceRevision: string; results: T[] } = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(manifest.results)) throw new Error(`Invalid existing export manifest: ${manifestPath}`);
    return manifest.results.map(file => {
      const inputRoot = file.inputRoot === undefined ? manifest.inputRoot ?? null : file.inputRoot;
      const sourceRevision = file.sourceRevision === undefined ? manifest.sourceRevision : file.sourceRevision;
      if ((inputRoot !== null && (typeof inputRoot !== "string" || !inputRoot.trim())) || typeof sourceRevision !== "string" || !sourceRevision.trim()) {
        throw new Error(`Invalid existing source provenance for ${file.path} in ${manifestPath}: expected an inputRoot string or null and a sourceRevision string.`);
      }
      return { ...file, inputRoot, sourceRevision };
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export function mergeResults<T extends { path: string }>(previous: ReadonlyArray<T>, current: ReadonlyArray<T>): T[] {
  const updated = new Set(current.map(file => file.path));
  return [...previous.filter(file => !updated.has(file.path)), ...current];
}
