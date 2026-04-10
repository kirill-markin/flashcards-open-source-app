import { enCatalog } from "./catalogs/en";

type CatalogShape<Node> = {
  readonly [Key in keyof Node]: Node[Key] extends string ? string : CatalogShape<Node[Key]>;
};

type JoinTranslationKey<Prefix extends string, Suffix extends string> = `${Prefix}.${Suffix}`;

type TranslationKeyForNode<Node> = {
  [Key in keyof Node & string]: Node[Key] extends string
    ? Key
    : JoinTranslationKey<Key, TranslationKeyForNode<Node[Key]>>;
}[keyof Node & string];

export type TranslationCatalog = CatalogShape<typeof enCatalog>;
export type TranslationKey = TranslationKeyForNode<typeof enCatalog>;
