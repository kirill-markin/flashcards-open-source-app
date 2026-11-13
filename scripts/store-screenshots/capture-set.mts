function sourceCountError(directory: string, tag: string, index: number, count: number): Error {
  return new Error(`Expected one source matching ${directory}/${tag}-${index}_*.png; found ${count}. Capture the selected five-shot set first.`);
}

export function findCaptureSet(names: readonly string[], tag: string, indices: readonly number[], directory: string): string[] | undefined {
  const matches = indices.map(index => names.filter(name => name.startsWith(`${tag}-${index}_`) && name.endsWith(".png")));
  if (matches.every(files => files.length === 0)) return undefined;
  return matches.map((files, position) => {
    if (files.length !== 1) throw sourceCountError(directory, tag, indices[position], files.length);
    return files[0];
  });
}

export function requireCaptureSet(names: readonly string[], tag: string, indices: readonly number[], directory: string): string[] {
  const set = findCaptureSet(names, tag, indices, directory);
  if (set === undefined) throw sourceCountError(directory, tag, indices[0], 0);
  return set;
}
