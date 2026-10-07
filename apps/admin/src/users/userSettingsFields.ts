export type UserSettingsFieldKind = "text" | "enum" | "date" | "boolean";

/** `sql` reads the `settings` alias of `org.user_settings`; a `date` field is the raw timestamp. */
type UserSettingsFieldShape<Id extends string> = Readonly<{ id: Id; label: string; kind: UserSettingsFieldKind; sql: string }>;

const fields = [
  { id: "settings-locale", label: "Saved app language", kind: "enum", sql: "settings.locale" },
  { id: "current-workspace", label: "Current workspace", kind: "text", sql: "settings.workspace_id::text" },
  { id: "progress-time-zone", label: "Progress time zone", kind: "enum", sql: "settings.progress_time_zone" },
  { id: "analytics-consent", label: "Analytics consent", kind: "enum", sql: "settings.analytics_consent" },
  // NULL is no answer, which collection reads as on.
  { id: "product-analytics", label: "Product analytics", kind: "boolean", sql: "settings.product_analytics_enabled" },
  { id: "reaction-animations", label: "Review reaction animations", kind: "boolean", sql: "settings.review_reaction_animations_enabled" },
  { id: "accent-color", label: "Accent color", kind: "enum", sql: "settings.accent_color" },
] as const satisfies ReadonlyArray<UserSettingsFieldShape<string>>;

export type UserSettingsFieldId = (typeof fields)[number]["id"];

export type UserSettingsField = UserSettingsFieldShape<UserSettingsFieldId>;

/**
 * The per-person settings, in render order, shared by the Users list columns and the profile's
 * Settings section so a setting cannot reach only one of them. `id` is the Users list column id,
 * which is URL vocabulary: renaming one breaks saved links.
 */
export const userSettingsFields: ReadonlyArray<UserSettingsField> = fields;
