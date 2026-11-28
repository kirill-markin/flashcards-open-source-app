import { z } from "zod";

export const cardStatusSchema = z.enum(["active", "suspended"]);
export type CardStatus = z.infer<typeof cardStatusSchema>;
