import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const maxFileBytes = 5 * 1024 * 1024;
const maxMarketingBytes = 25 * 1024 * 1024;
const externalRoots = ["apps/ios/docs/media/", "apps/android/docs/media/"];
const mediaExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".heic", ".pdf", ".mov", ".mp4", ".ico", ".icns", ".psd", ".sketch"]);
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const violations = [];
let marketingBytes = 0;

for (const file of tracked) {
  const path = resolve(root, file);
  const size = statSync(path).size;
  if (size > maxFileBytes) {
    violations.push(`${file}: ${size} bytes exceeds the 5 MiB Git file limit; publish large assets outside Git`);
  }
  const external = externalRoots.some(prefix => file.startsWith(prefix));
  const renderingAsset = file.startsWith("scripts/store-screenshots/assets/");
  if (external || renderingAsset) {
    const bytes = readFileSync(path);
    const media = mediaExtensions.has(extname(file).toLowerCase()) || bytes.includes(0) || !Buffer.from(bytes.toString("utf8")).equals(bytes);
    if (external && media) {
      violations.push(`${file}: marketing media belongs in the public media archive; see docs/media-assets.md`);
    }
    if (media) marketingBytes += size;
  }
}

if (marketingBytes > maxMarketingBytes) {
  violations.push(`Tracked marketing/rendering media totals ${marketingBytes} bytes, exceeding the 25 MiB budget; externalize bulk assets`);
}
if (violations.length > 0) {
  console.error("Repository size policy failed:\n" + violations.join("\n"));
  process.exit(1);
}
console.log("Repository size policy passed.", { trackedFiles: tracked.length, marketingBytes, maxFileBytes, maxMarketingBytes });

// History introduced since the PR base is checked too, not only the tip: merging a pre-cleanup
// branch would make the removed media history reachable again even if its tip deletes the files.
const baseRef = `origin/${process.env.PR_BASE_REF?.trim() || "main"}`;
const introducedObjects = execFileSync("git", ["rev-list", "--objects", `${baseRef}..HEAD`], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  .split("\n").filter(Boolean).map(line => {
    const separator = line.indexOf(" ");
    return { id: separator === -1 ? line : line.slice(0, separator), path: separator === -1 ? "" : line.slice(separator + 1) };
  });
if (introducedObjects.length > 0) {
  const objectSizes = execFileSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
    cwd: root, encoding: "utf8", input: introducedObjects.map(object => object.id).join("\n") + "\n",
    maxBuffer: 32 * 1024 * 1024,
  }).trim().split("\n");
  const historyViolations = [];
  let introducedBlobBytes = 0;
  for (let index = 0; index < introducedObjects.length; index += 1) {
    const [id, type, sizeText] = objectSizes[index].split(" ");
    if (type !== "blob") continue;
    const size = Number(sizeText);
    const file = introducedObjects[index].path;
    introducedBlobBytes += size;
    if (size > maxFileBytes) historyViolations.push(`${file} (${id}): introduced historical blob exceeds 5 MiB`);
    if (externalRoots.some(prefix => file.startsWith(prefix))) {
      const knownMedia = mediaExtensions.has(extname(file).toLowerCase());
      const bytes = knownMedia ? Buffer.alloc(0) : execFileSync("git", ["cat-file", "blob", id], { cwd: root, maxBuffer: Math.max(size + 1024, 1024 * 1024) });
      if (knownMedia || bytes.includes(0) || !Buffer.from(bytes.toString("utf8")).equals(bytes)) {
        historyViolations.push(`${file} (${id}): introduced historical marketing media belongs outside Git`);
      }
    }
  }
  if (introducedBlobBytes > maxMarketingBytes) {
    historyViolations.push(`New history introduces ${introducedBlobBytes} blob bytes, exceeding the 25 MiB per-PR budget`);
  }
  if (historyViolations.length > 0) {
    console.error("Repository history size policy failed:\n" + historyViolations.join("\n") + "\nReapply source changes on a fresh branch; do not merge pre-cleanup branches. See docs/media-assets.md.");
    process.exit(1);
  }
  console.log("Introduced Git history size policy passed.", { baseRef, introducedBlobBytes });
}
