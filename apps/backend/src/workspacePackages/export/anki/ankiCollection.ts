import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type AnkiNote = Readonly<{
  guid: string;
  front: string;
  back: string;
  tags: ReadonlyArray<string>;
}>;

export const defaultAnkiExportDeckName = "Nibomo Export";

// Keep the note type ID stable so Anki can match it on repeat imports.
const noteTypeId = 1905170063155;

const basicNoteType = {
  id: noteTypeId,
  name: "Nibomo Basic",
  type: 0,
  mod: 0,
  usn: -1,
  sortf: 0,
  did: null,
  tmpls: [{
    name: "Card 1",
    ord: 0,
    qfmt: "{{Front}}",
    afmt: "{{FrontSide}}<hr id=answer>{{Back}}",
    bqfmt: "",
    bafmt: "",
    did: null,
  }],
  flds: ["Front", "Back"].map((name, ord) => ({
    name,
    ord,
    sticky: false,
    rtl: false,
    font: "Arial",
    size: 20,
  })),
  css: ".card { font: 20px/1.5 sans-serif; text-align: start; } img { max-width: 100%; height: auto; } pre { overflow-x: auto; }",
  latexPre: "",
  latexPost: "",
  latexsvg: false,
  req: [[0, "any", [0]]],
};

const defaultDeckConfig = {
  id: 1,
  name: "Default",
  mod: 0,
  usn: 0,
  maxTaken: 60,
  autoplay: true,
  timer: 0,
  replayq: true,
  new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20 },
  rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
  lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
  dyn: false,
};

const htmlEntities: ReadonlyMap<string, string> = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
]);

function ankiSortField(html: string): string {
  const stripped = html.replace(/<img\b[^>]*\bsrc="([^"]*)"[^>]*>/gu, " $1 ").replace(/<[^>]*>/gu, "");
  return stripped.replace(/&(?:amp|lt|gt|quot|#\d+);/gu, (entity) => {
    if (entity.startsWith("&#")) {
      return String.fromCodePoint(Number(entity.slice(2, -1)));
    }
    return htmlEntities.get(entity) ?? entity;
  });
}

function encodeTagCharacter(character: string): string {
  return "%" + character.codePointAt(0)!.toString(16) + ";";
}

function serializeTags(tags: ReadonlyArray<string>): string {
  const values = [...new Set(tags.filter((tag) => tag !== "").map((tag) => (
    // Anki treats whitespace, colons, case and Unicode normalization as part of its tag syntax or identity.
    tag === tag.normalize("NFC")
      ? tag.replace(/[%:\s\p{Cc}\p{Changes_When_Casefolded}\p{Changes_When_Lowercased}]/gu, encodeTagCharacter)
      : Array.from(tag, encodeTagCharacter).join("")
  )))].sort();
  return values.length === 0 ? "" : " " + values.join(" ") + " ";
}

function createDeck(id: number, name: string, modifiedAt: number) {
  return {
    id,
    name,
    mod: modifiedAt,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc: "",
    dyn: 0,
    conf: 1,
    extendNew: 0,
    extendRev: 0,
  };
}

export function createAnkiCollection(
  database: DatabaseSync,
  label: string | undefined,
  generatedAt: string,
  notes: ReadonlyArray<AnkiNote>,
): void {
  const nowMs = Date.parse(generatedAt);
  const now = Math.floor(nowMs / 1_000);
  const normalizedName = label?.normalize("NFC").replace(/\p{Cc}+/gu, " ").replace(/:{2,}/gu, "：").replace(/^[\s:]+|[\s:]+$/gu, "");
  const name = normalizedName || defaultAnkiExportDeckName;
  const deckId = name.toLowerCase() === "default" ? 1 : 2;
  const decks = { 1: createDeck(1, "Default", 0), [deckId]: createDeck(deckId, name, now) };
  const config = { curModel: noteTypeId, curDeck: deckId, activeDecks: [deckId], nextPos: notes.length + 1, schedVer: 2 };

  database.exec(
    "CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, "
    + "ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, "
    + "models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL); "
    + "CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, "
    + "usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, "
    + "flags integer NOT NULL, data text NOT NULL); "
    + "CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, "
    + "mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, "
    + "ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, "
    + "left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL); "
    + "CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, "
    + "ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL); "
    + "CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL); "
    + "CREATE INDEX ix_notes_usn ON notes (usn); "
    + "CREATE INDEX ix_cards_usn ON cards (usn); "
    + "CREATE INDEX ix_revlog_usn ON revlog (usn); "
    + "CREATE INDEX ix_cards_nid ON cards (nid); "
    + "CREATE INDEX ix_cards_sched ON cards (did, queue, due); "
    + "CREATE INDEX ix_revlog_cid ON revlog (cid); "
    + "CREATE INDEX ix_notes_csum ON notes (csum); "
    + "BEGIN",
  );

  database.prepare("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')").run(
    now,
    nowMs,
    nowMs,
    JSON.stringify(config),
    JSON.stringify({ [noteTypeId]: basicNoteType }),
    JSON.stringify(decks),
    JSON.stringify({ 1: defaultDeckConfig }),
  );
  const insertNote = database.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')");
  const insertNewCard = database.prepare(
    "INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) "
    + "VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '{}')",
  );
  for (const [index, note] of notes.entries()) {
    const noteId = nowMs + index;
    const sortField = ankiSortField(note.front);
    const checksum = createHash("sha1").update(sortField).digest().readUInt32BE();
    insertNote.run(noteId, note.guid, noteTypeId, now, serializeTags(note.tags), note.front + "\u001f" + note.back, sortField, checksum);
    insertNewCard.run(noteId + notes.length, noteId, deckId, now, index + 1);
  }
  database.exec("COMMIT");
}
