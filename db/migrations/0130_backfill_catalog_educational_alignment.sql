-- Migration status: Current / one-time backfill.
-- Introduces: the educational_subject, educational_framework and educational_level values for the
--   115 catalog package slugs that were already published before the deck-publishing standard
--   began requiring them. No new database object of any kind and no schema change: 0128 added the
--   three columns, and this file fills them on catalog.packages and on every published
--   catalog.package_versions row of the same packages.
-- Schemas touched/read explicitly: catalog, pg_catalog, pg_temp.
--
--
-- WHERE THE VALUES COME FROM
--
-- The list below is an approved slug -> subject / framework / level table, transcribed verbatim.
-- Nothing is derived from a deck's title, tags or cards at run time and no value is invented, so a
-- slug the approved table does not name keeps whatever it already has.
--
-- Every row carries a subject. framework and level are NULL together for an evergreen topic deck -
-- world capitals, amino acids, the kana syllabaries - that is aligned to no named exam, curriculum
-- or standard; 58 of the 115 rows name a real one and carry all three. That split is what the
-- columns are for and is not missing data, which is why 0128 made framework and level nullable and
-- why they stay nullable.
--
-- The values are written in each deck's own audience language, so 'Anatomía', '日本史' and
-- 'Berufs- und Arbeitspädagogik' sit beside 'Chemistry' on purpose. They are not translated,
-- case-normalized or otherwise tidied here: the marketing website prints them into the visible
-- deck page row and into the schema.org educationalAlignment targetName exactly as stored.
--
-- The approved table carries an audience-language column that is deliberately not stored. It
-- exists so each value can be checked against the language its deck teaches in, and
-- catalog.package_versions.language_tags already holds that fact. Every one of the 115 rows was
-- checked against the public snapshot and none disagrees with that package's language_tags.
--
--
-- WHITESPACE AND INVISIBLE CHARACTERS ARE NORMALIZED AT THIS SOURCE
--
-- Both marketing-website emitters keep these three values verbatim rather than trimming, matching
-- the parser's own convention of preserving untrimmed strings, and both decide presence on a
-- trimmed comparison. Padding therefore cannot make a value vanish, but it does reach the visible
-- page row and the schema.org targetName; a zero-width character survives String.prototype.trim()
-- entirely and would render a visually empty row and an empty targetName rather than being
-- dropped. Fixing that here is the cheaper half of the trade, so every value below was checked
-- before it was written and is already clean. The DO block checks it again rather than trusting
-- the transcription.
--
--
-- WHY NO TRIGGER HAS TO BE TOUCHED
--
-- catalog.prevent_published_package_version_update() enumerates by name the columns a published or
-- delisted version may not change, and 0128 deliberately left the three educational_* columns out
-- of that list because they classify a deck rather than describe what an install of that version
-- delivered. A plain UPDATE of a published row is therefore permitted and this file contains no
-- ALTER TABLE ... DISABLE TRIGGER. 0129 needed one only because language_tags is inside that
-- guard; this migration is the case 0128's exclusion was written for.
--
--
-- WHAT IS WRITTEN AND WHAT IS NOT
--
-- Two UPDATEs and nothing else:
--   * catalog.packages, the mutable authoring draft row, so the next version created from it
--     inherits the classification instead of freezing another NULL;
--   * every catalog.package_versions row of the same package whose status is 'published', which is
--     what the public snapshot projects and what the website reads.
--
-- Rows in any other status are left alone. A delisted version reaches no public surface, and a
-- draft, submitted, needs_changes or approved row is an in-flight edit whose alignment belongs to
-- whoever is editing it. Requiring a subject everywhere is 0131's job and not this file's.
--
-- No title, summary, description, language tag, card, media asset or license is touched and no new
-- package version is created: the columns sit outside the immutability guard precisely so a
-- classification fix does not have to become a version nobody asked for.
--
-- packages_set_updated_at and package_versions_set_updated_at stay enabled, so every row this file
-- actually writes takes a fresh updated_at and its updatedAt in the public snapshot moves to the
-- migration's timestamp. That is deliberate and matches 0129: the backfill is recorded rather than
-- hidden. package_versions_status_transition is BEFORE UPDATE OF status and never fires, because
-- neither statement mentions that column.
--
--
-- RE-RUN AND ENVIRONMENT SAFETY
--
-- Both UPDATEs join on slug, so a slug the database does not hold is an unmatched join row rather
-- than an error, and both carry an IS DISTINCT FROM guard, so a row that already holds the
-- approved triple is not written at all and keeps its updated_at. Running this file a second time
-- therefore writes nothing, and a fresh database holding none of the 115 slugs writes nothing and
-- says so in its notice.
--
-- The approved table's 115 slugs and the live public catalog's published slugs are an exact
-- one-for-one match, established from the public snapshot artifact rather than a paginated API
-- listing: the snapshot holds exactly 115 published packages, every one of them is named in the
-- table and every slug in the table answers to one of them. No slug is unmatched in either
-- direction, so no published deck is left without a subject.
--
-- What this file asserts, and aborts the release on:
--   * the literal list loads exactly 115 rows, which is what catches a row lost or duplicated
--     while transcribing 115 hand-written lines;
--   * no approved value is empty, space-padded, or carrying a zero-width or bidi format character;
--   * after both UPDATEs, every matched package row and every published version row of a matched
--     package holds exactly the approved triple.
-- The matched and written counts are environment-dependent - 115 packages in production, one in
-- the postgres-integration database, none in a fresh one - so they are reported in a notice rather
-- than asserted against a number that would be wrong somewhere.
--
--
-- CI REHEARSAL
--
-- apps/backend/scripts/postgresIntegrations/boundaries.mjs declares a boundary at this file, so it
-- is executed against a real PostgreSQL before a release runs it.
-- seedMigration0129LegacyCatalogLanguageTag in
-- apps/backend/scripts/postgresIntegrations/migrations.mjs inserts package slug
-- us-citizenship-test with four published versions and NULL alignment columns just before 0129
-- runs, and that slug is in the list below, so at this boundary the migration writes exactly one
-- catalog.packages row and four published catalog.package_versions rows.
-- apps/backend/src/catalog/authoring/versions/educationalAlignmentBackfill.postgres.integration.ts
-- reads that result, applies this file a second time to prove the re-run writes nothing, and
-- proves the published-version guard is still armed afterwards. The 0129 boundary stops one file
-- earlier and never applies this one, so its assertion that version 4 was never written stays
-- true.
--
-- The public snapshot artifact is rebuilt by admin writes and never by SQL, so nothing here tries
-- to regenerate it; that is a deploy step.

CREATE TEMP TABLE migration_0130_approved_alignment (
  slug                  TEXT PRIMARY KEY,
  educational_subject   TEXT NOT NULL,
  educational_framework TEXT,
  educational_level     TEXT
) ON COMMIT DROP;

INSERT INTO migration_0130_approved_alignment (
  slug, educational_subject, educational_framework, educational_level
) VALUES
  ('academic-vocabulary-flashcards-300-words-in-context', 'English vocabulary', NULL, NULL),
  ('advanced-high-school-chemistry-flashcards', 'Chemistry', NULL, NULL),
  ('aevo-ausbildereignungspruefung-karteikarten', 'Berufs- und Arbeitspädagogik', 'IHK Ausbildereignung', 'AEVO'),
  ('algebra-based-physics-1-flashcards', 'Physics', NULL, NULL),
  ('amino-acid-flashcards', 'Biochemistry', NULL, NULL),
  ('anatomical-directional-terms', 'Anatomy', NULL, NULL),
  ('ap-biology-flashcards-complete-course-review', 'Biology', 'College Board Advanced Placement', 'AP Biology'),
  ('ap-calculus-ab-flashcards', 'Mathematics', 'College Board Advanced Placement', 'AP Calculus AB'),
  ('ap-chemistry-flashcards', 'Chemistry', 'College Board Advanced Placement', 'AP Chemistry'),
  ('ap-physics-1-flashcards', 'Physics', 'College Board Advanced Placement', 'AP Physics 1'),
  ('ap-psychology-flashcards', 'Psychology', 'College Board Advanced Placement', 'AP Psychology'),
  ('ap-statistics-flashcards', 'Statistics', 'College Board Advanced Placement', 'AP Statistics'),
  ('ap-us-history-apush-flashcards', 'History', 'College Board Advanced Placement', 'AP United States History'),
  ('asvab-flashcards-complete-review', 'General aptitude', 'ASVAB', 'ASVAB'),
  ('ati-teas-7-science-flashcards', 'Science', 'ATI TEAS', 'TEAS 7 Science'),
  ('aws-solutions-architect-associate-saa-c03-flashcards', 'Cloud computing', 'AWS Certification', 'Solutions Architect Associate SAA-C03'),
  ('basic-hiragana-romaji', 'Japanese language', NULL, NULL),
  ('basic-katakana-romaji', 'Japanese language', NULL, NULL),
  ('bharat-rajya-rajdhani-flashcards-hindi', 'भूगोल', NULL, NULL),
  ('bharatiya-samvidhan-anuchhed-flashcards-hindi', 'नागरिक शास्त्र', NULL, NULL),
  ('blind-75-python-solutions', 'Computer science', NULL, NULL),
  ('california-permit-test-flashcards', 'Road safety', 'California DMV', 'Permit test'),
  ('ccsp-2026-exam-flashcards', 'Cloud security', 'ISC2 Certification', 'CCSP'),
  ('ccsp-2026-japanese-flashcards', 'クラウドセキュリティ', 'ISC2 Certification', 'CCSP'),
  ('cell-organelles-functions', 'Biology', NULL, NULL),
  ('cet-4-core-vocabulary-flashcards-chinese', '英语词汇', '全国大学英语四、六级考试', 'CET-4'),
  ('cfa-level-3-portfolio-management-flashcards-chinese', '投资组合管理', 'CFA Program', 'CFA Level III'),
  ('circle-of-fifths-flashcards', 'Music theory', NULL, NULL),
  ('coding-interview-patterns-flashcards-chinese', '计算机科学', NULL, NULL),
  ('common-network-port-numbers-flashcards', 'Computer networking', NULL, NULL),
  ('common-test-japanese-history-chronology-flashcards', '日本史', '大学入学共通テスト', '歴史総合・日本史探究'),
  ('comptia-a-plus-220-1201-220-1202-flashcards', 'Information technology', 'CompTIA Certification', 'A+ 220-1201 and 220-1202'),
  ('comptia-security-plus-sy0-701-flashcards', 'Cybersecurity', 'CompTIA Certification', 'Security+ SY0-701'),
  ('constitucion-espanola-oposiciones-tarjetas', 'Derecho constitucional', 'Oposiciones', 'Constitución Española'),
  ('dele-b2-conectores-expresiones-tarjetas', 'Español', 'Marco Común Europeo de Referencia', 'DELE B2'),
  ('digital-sat-flashcards-math-grammar-words-in-context', 'General aptitude', 'College Board', 'Digital SAT'),
  ('division-flashcards-1-12', 'Mathematics', NULL, NULL),
  ('ege-2026-russian-orthoepy-flashcards', 'Русский язык', 'ЕГЭ', 'ЕГЭ по русскому языку'),
  ('ege-history-dates-personalities-flashcards-russian', 'История', 'ЕГЭ', 'ЕГЭ по истории'),
  ('ege-social-studies-terms-flashcards-russian', 'Обществознание', 'ЕГЭ', 'ЕГЭ по обществознанию'),
  ('eiken-grade-2-vocabulary-flashcards-japanese', '英語', '実用英語技能検定', '英検2級'),
  ('einbuergerungstest-deutschland-karteikarten', 'Staatsbürgerkunde', 'Einbürgerungstest Deutschland', 'Einbürgerungstest'),
  ('electron-configuration-flashcards-all-elements', 'Chemistry', NULL, NULL),
  ('english-beginner-vocabulary-arabic-flashcards', 'اللغة الإنجليزية', NULL, NULL),
  ('english-irregular-verbs-flashcards', 'English grammar', NULL, NULL),
  ('eu-ai-act-2026-essentials-flashcards', 'Law', NULL, NULL),
  ('examen-manejo-california-espanol-tarjetas', 'Seguridad vial', 'California DMV', 'Examen de manejo'),
  ('faa-part-107-flashcards', 'Aviation', 'FAA Certification', 'Part 107 Remote Pilot'),
  ('fe-exam-engineering-equations-units-flashcards', 'Engineering', 'NCEES', 'FE Exam'),
  ('five-unit-psychology-course-review', 'Psychology', NULL, NULL),
  ('fuehrerschein-klasse-b-verkehrszeichen-karteikarten', 'Verkehrsrecht', 'Führerscheinprüfung', 'Klasse B'),
  ('fundamental-information-technology-engineer-subject-a-flashcards-japanese', '情報技術', '情報処理技術者試験', '基本情報技術者試験 科目A'),
  ('gaokao-derivatives-flashcards-chinese', '数学', '普通高等学校招生全国统一考试', '高考数学'),
  ('git-commands-flashcards', 'Computer science', NULL, NULL),
  ('gmat-quant-verbal-data-insights-flashcards', 'General aptitude', 'GMAC', 'GMAT'),
  ('goethe-zertifikat-b1-wortschatz-karteikarten', 'Deutsch als Fremdsprache', 'Gemeinsamer Europäischer Referenzrahmen', 'Goethe-Zertifikat B1'),
  ('gre-vocabulary-flashcards', 'English vocabulary', 'ETS', 'GRE'),
  ('greek-alphabet-flashcards', 'Greek alphabet', NULL, NULL),
  ('ham-radio-technician-2026-2030-flashcards', 'Radio communication', 'FCC Amateur Radio', 'Technician class'),
  ('http-status-code-flashcards', 'Computer networking', NULL, NULL),
  ('huesos-cuerpo-humano-anatomia-tarjetas', 'Anatomía', NULL, NULL),
  ('human-body-systems-flashcards', 'Anatomy', NULL, NULL),
  ('ib-biology-sl-flashcards', 'Biology', 'International Baccalaureate', 'IB Biology SL'),
  ('ielts-academic-vocabulary-flashcards-arabic', 'اللغة الإنجليزية', 'IELTS', 'IELTS Academic'),
  ('india-national-parks-flashcards-hindi', 'भूगोल', NULL, NULL),
  ('it-passport-shiken-yougo-flashcards', '情報技術', '情報処理技術者試験', 'ITパスポート試験'),
  ('japanese-gojuon-hiragana-katakana-chinese-flashcards', '日语', NULL, NULL),
  ('jlpt-n4-kanji-flashcards', 'Japanese language', 'Japanese-Language Proficiency Test', 'JLPT N4'),
  ('jlpt-n5-kanji-flashcards', 'Japanese language', 'Japanese-Language Proficiency Test', 'JLPT N5'),
  ('kaoyan-english-one-core-vocabulary-flashcards-chinese', '英语词汇', '全国硕士研究生招生考试', '考研英语（一）'),
  ('linux-command-line-flashcards', 'Computer science', NULL, NULL),
  ('major-minor-key-signatures', 'Music theory', NULL, NULL),
  ('mcat-physics-chemistry-equations-flashcards', 'Physical sciences', 'AAMC', 'MCAT'),
  ('medical-abbreviation-flashcards', 'Medicine', NULL, NULL),
  ('medical-terminology-word-parts', 'Medical terminology', NULL, NULL),
  ('metric-prefix-flashcards', 'Measurement', NULL, NULL),
  ('morse-code-alphabet-numbers', 'Radio communication', NULL, NULL),
  ('multiplication-flashcards-1-12', 'Mathematics', NULL, NULL),
  ('music-interval-flashcards', 'Music theory', NULL, NULL),
  ('music-note-flashcards-treble-bass', 'Music theory', NULL, NULL),
  ('nato-phonetic-alphabet-flashcards', 'Radio communication', NULL, NULL),
  ('ncert-class-10-acids-bases-salts-flashcards-hindi', 'रसायन विज्ञान', 'NCERT', 'कक्षा 10'),
  ('nepravilnye-glagoly-angliyskogo-flashcards', 'Английская грамматика', NULL, NULL),
  ('new-hsk-1-vocabulary-flashcards', 'Chinese language', 'HSK', 'HSK 1'),
  ('nissho-bookkeeping-3-journal-entry-flashcards-japanese', '簿記', '日商簿記検定', '日商簿記3級'),
  ('nremt-emt-flashcards-assessment-treatment-operations', 'Emergency medicine', 'NREMT', 'EMT'),
  ('ntce-comprehensive-quality-flashcards-chinese', '教师专业素养', '中小学教师资格考试', '科目一《综合素质》'),
  ('pance-blueprint-clinical-review-flashcards', 'Medicine', 'NCCPA', 'PANCE'),
  ('periodic-table-elements', 'Chemistry', NULL, NULL),
  ('periodic-table-elements-russian-flashcards', 'Химия', NULL, NULL),
  ('periodic-trends-flashcards', 'Chemistry', NULL, NULL),
  ('pharmacology-drug-class-flashcards', 'Pharmacology', NULL, NULL),
  ('pmp-2026-exam-flashcards', 'Project management', 'PMI Certification', 'PMP'),
  ('polyatomic-ion-flashcards', 'Chemistry', NULL, NULL),
  ('qudurat-general-aptitude-rules-flashcards-arabic', 'القدرات العامة', 'هيئة تقويم التعليم والتدريب', 'اختبار القدرات العامة'),
  ('senales-trafico-dgt-permiso-b-tarjetas', 'Seguridad vial', 'DGT', 'Permiso B'),
  ('si-units-flashcards', 'Measurement', NULL, NULL),
  ('spanish-a1-vocabulary-flashcards', 'Spanish language', 'Common European Framework of Reference', 'A1'),
  ('spanish-numbers-1-100', 'Spanish language', NULL, NULL),
  ('spanish-present-tense-verbs', 'Spanish grammar', NULL, NULL),
  ('spanish-preterite-vs-imperfect-flashcards', 'Spanish grammar', NULL, NULL),
  ('tabla-periodica-elementos-tarjetas-espanol', 'Química', NULL, NULL),
  ('tahsili-biology-flashcards-arabic', 'الأحياء', 'هيئة تقويم التعليم والتدريب', 'الاختبار التحصيلي'),
  ('terminologia-medica-prefijos-raices-sufijos', 'Terminología médica', NULL, NULL),
  ('toefl-academic-vocabulary-chinese-flashcards', '英语词汇', 'ETS', 'TOEFL'),
  ('triad-chord-spelling-flashcards', 'Music theory', NULL, NULL),
  ('unit-circle-degrees-radians-coordinates', 'Mathematics', NULL, NULL),
  ('us-citizenship-test', 'Civics', 'USCIS Naturalization Test', 'Civics test'),
  ('us-citizenship-test-russian', 'Граждановедение США', 'USCIS Naturalization Test', 'Civics test'),
  ('us-constitutional-amendments', 'Civics', NULL, NULL),
  ('us-presidents-in-order-flashcards', 'History', NULL, NULL),
  ('us-state-abbreviations-flashcards', 'Geography', NULL, NULL),
  ('us-states-and-capitals', 'Geography', NULL, NULL),
  ('world-capitals-flashcards', 'Geography', NULL, NULL),
  ('world-history-1200-present-flashcards', 'History', NULL, NULL);

DO $migration$
DECLARE
  approved_row_count CONSTANT BIGINT := 115;
  -- Spelled as code points rather than as literal characters so the set stays readable here and
  -- cannot be lost to an editor that strips invisible characters: U+00AD SOFT HYPHEN, U+200B ZERO
  -- WIDTH SPACE, U+200C ZERO WIDTH NON-JOINER, U+200D ZERO WIDTH JOINER, U+200E LEFT-TO-RIGHT
  -- MARK, U+200F RIGHT-TO-LEFT MARK, U+2060 WORD JOINER and U+FEFF ZERO WIDTH NO-BREAK SPACE.
  invisible_characters CONSTANT TEXT :=
    pg_catalog.chr(173)
    || pg_catalog.chr(8203)
    || pg_catalog.chr(8204)
    || pg_catalog.chr(8205)
    || pg_catalog.chr(8206)
    || pg_catalog.chr(8207)
    || pg_catalog.chr(8288)
    || pg_catalog.chr(65279);
  loaded_row_count BIGINT;
  offending_value TEXT;
  matched_package_count BIGINT;
  matched_version_count BIGINT;
  written_package_count INTEGER;
  written_version_count INTEGER;
  violation_count BIGINT;
BEGIN
  SELECT pg_catalog.count(*)
  INTO loaded_row_count
  FROM migration_0130_approved_alignment;

  IF loaded_row_count <> approved_row_count THEN
    RAISE EXCEPTION 'Catalog educational alignment backfill loaded % approved rows instead of %',
      loaded_row_count,
      approved_row_count
      USING ERRCODE = '23514';
  END IF;

  SELECT approved.slug
    || ' ' || candidate.column_name
    || '=' || pg_catalog.quote_literal(candidate.value)
  INTO offending_value
  FROM migration_0130_approved_alignment AS approved
  CROSS JOIN LATERAL (
    VALUES
      ('educational_subject'::TEXT, approved.educational_subject),
      ('educational_framework', approved.educational_framework),
      ('educational_level', approved.educational_level)
  ) AS candidate(column_name, value)
  WHERE candidate.value IS NOT NULL
    AND (
      candidate.value = ''
      OR candidate.value <> pg_catalog.btrim(candidate.value)
      OR pg_catalog.translate(candidate.value, invisible_characters, '') <> candidate.value
    )
  ORDER BY approved.slug, candidate.column_name
  LIMIT 1;

  IF offending_value IS NOT NULL THEN
    RAISE EXCEPTION 'Approved catalog educational alignment value is empty, padded or carries an invisible character: %',
      offending_value
      USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)
  INTO matched_package_count
  FROM migration_0130_approved_alignment AS approved
  JOIN catalog.packages AS packages
    ON packages.slug = approved.slug;

  SELECT pg_catalog.count(*)
  INTO matched_version_count
  FROM migration_0130_approved_alignment AS approved
  JOIN catalog.packages AS packages
    ON packages.slug = approved.slug
  JOIN catalog.package_versions AS package_versions
    ON package_versions.package_id = packages.package_id
  WHERE package_versions.status = 'published';

  UPDATE catalog.packages AS packages
  SET
    educational_subject = approved.educational_subject,
    educational_framework = approved.educational_framework,
    educational_level = approved.educational_level
  FROM migration_0130_approved_alignment AS approved
  WHERE packages.slug = approved.slug
    AND (
      packages.educational_subject,
      packages.educational_framework,
      packages.educational_level
    ) IS DISTINCT FROM (
      approved.educational_subject,
      approved.educational_framework,
      approved.educational_level
    );

  GET DIAGNOSTICS written_package_count = ROW_COUNT;

  UPDATE catalog.package_versions AS package_versions
  SET
    educational_subject = approved.educational_subject,
    educational_framework = approved.educational_framework,
    educational_level = approved.educational_level
  FROM catalog.packages AS packages
  JOIN migration_0130_approved_alignment AS approved
    ON approved.slug = packages.slug
  WHERE package_versions.package_id = packages.package_id
    AND package_versions.status = 'published'
    AND (
      package_versions.educational_subject,
      package_versions.educational_framework,
      package_versions.educational_level
    ) IS DISTINCT FROM (
      approved.educational_subject,
      approved.educational_framework,
      approved.educational_level
    );

  GET DIAGNOSTICS written_version_count = ROW_COUNT;

  SELECT pg_catalog.count(*)
  INTO violation_count
  FROM migration_0130_approved_alignment AS approved
  JOIN catalog.packages AS packages
    ON packages.slug = approved.slug
  WHERE (
      packages.educational_subject,
      packages.educational_framework,
      packages.educational_level
    ) IS DISTINCT FROM (
      approved.educational_subject,
      approved.educational_framework,
      approved.educational_level
    );

  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Catalog educational alignment backfill left % catalog.packages rows off their approved values',
      violation_count
      USING ERRCODE = '40001';
  END IF;

  SELECT pg_catalog.count(*)
  INTO violation_count
  FROM migration_0130_approved_alignment AS approved
  JOIN catalog.packages AS packages
    ON packages.slug = approved.slug
  JOIN catalog.package_versions AS package_versions
    ON package_versions.package_id = packages.package_id
  WHERE package_versions.status = 'published'
    AND (
      package_versions.educational_subject,
      package_versions.educational_framework,
      package_versions.educational_level
    ) IS DISTINCT FROM (
      approved.educational_subject,
      approved.educational_framework,
      approved.educational_level
    );

  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Catalog educational alignment backfill left % published catalog.package_versions rows off their approved values',
      violation_count
      USING ERRCODE = '40001';
  END IF;

  RAISE NOTICE 'Catalog educational alignment backfilled: approved_slugs=% matched_packages=% matched_published_versions=% package_rows_written=% version_rows_written=%',
    approved_row_count,
    matched_package_count,
    matched_version_count,
    written_package_count,
    written_version_count;
END;
$migration$;
