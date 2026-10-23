// The largest structured tool input has 100 tag elements and three argument keys.
export const MAX_MCP_TOOL_INPUT_ELEMENTS = 128;

// Bulk SQL authoring travels as text; allow 1 MiB while bounding non-tool messages too.
export const MAX_MCP_REQUEST_BODY_BYTES = 1024 * 1024;
