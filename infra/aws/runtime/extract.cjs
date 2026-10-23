const { createHash } = require("node:crypto");
const { createReadStream, createWriteStream, existsSync, mkdirSync, chmodSync, renameSync } = require("node:fs");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { createGunzip } = require("node:zlib");
const manifest = require("/opt/nibomo-node/manifest.json");

async function extract() {
  if (manifest.arch !== process.arch || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error("Patched Node layer architecture or SHA256 manifest is invalid");
  }
  const directory = `/tmp/nibomo-node-${manifest.sha256}`;
  const executable = `${directory}/node`;
  const hash = createHash("sha256");
  let size = 0;
  const verify = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > manifest.size || size > 140 * 1024 * 1024) {
        callback(new Error("Patched Node binary exceeds its verified size"));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  if (existsSync(executable)) {
    for await (const chunk of createReadStream(executable)) {
      size += chunk.length;
      hash.update(chunk);
    }
  } else {
    mkdirSync(directory, { mode: 0o700 });
    await pipeline(createReadStream("/opt/nibomo-node/node.gz"), createGunzip(), verify,
      createWriteStream(`${executable}.partial`, { flags: "wx", mode: 0o700 }));
  }
  if (size !== manifest.size || hash.digest("hex") !== manifest.sha256) {
    throw new Error("Patched Node binary SHA256 or size mismatch; refusing startup");
  }
  if (!existsSync(executable)) {
    chmodSync(`${executable}.partial`, 0o700);
    renameSync(`${executable}.partial`, executable);
  }
  process.stdout.write(executable);
}

extract().catch((error) => {
  console.error("Patched Node extraction failed:", error);
  process.exitCode = 1;
});
