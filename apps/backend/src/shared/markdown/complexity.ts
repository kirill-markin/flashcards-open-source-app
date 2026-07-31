export class MarkdownComplexityError extends Error {
  readonly sourceIndex: number;
  readonly maximumDepth: number;

  constructor(sourceIndex: number, maximumDepth: number) {
    super(
      `Markdown inline label depth exceeds the supported limit at source index ${sourceIndex}. `
        + `maximumDepth=${maximumDepth}. Simplify nested Markdown labels and retry.`,
    );
    this.name = "MarkdownComplexityError";
    this.sourceIndex = sourceIndex;
    this.maximumDepth = maximumDepth;
  }
}
