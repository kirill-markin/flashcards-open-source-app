import { enCatalog } from "./catalogs/en";

// A plural label object may carry the `two` and `few` forms English does not have.
type OptionalPluralForms = {
  readonly zero?: string;
  readonly two?: string;
  readonly few?: string;
};

type CatalogShape<Node> = {
  readonly [Key in keyof Node]: Node[Key] extends string
    ? string
    : Node[Key] extends { one: string; other: string }
      ? CatalogShape<Node[Key]> & OptionalPluralForms
      : CatalogShape<Node[Key]>;
};

type JoinTranslationKey<Prefix extends string, Suffix extends string> = `${Prefix}.${Suffix}`;

type TranslationKeyForNode<Node> = {
  [Key in keyof Node & string]: Node[Key] extends string
    ? Key
    : JoinTranslationKey<Key, TranslationKeyForNode<Node[Key]>>;
}[keyof Node & string];

export type TranslationCatalog = CatalogShape<typeof enCatalog>;
export type TranslationKey = TranslationKeyForNode<typeof enCatalog>;
