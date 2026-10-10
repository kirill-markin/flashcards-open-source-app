/**
 * Why an attachment yields no derived files, phrased for the attachment line the model reads, such as an
 * archive over a limit. Any other error a parser throws is described with the parser's own message.
 */
export class DerivativeRefusal extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DerivativeRefusal";
  }
}
