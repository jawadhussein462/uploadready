import { zipSync, type Zippable } from "fflate";
import { uniqueNames } from "./naming";

/** Store files without recompression (they are already compressed). */
export function zipFiles(files: { name: string; bytes: Uint8Array }[], folder?: string): Blob {
  const names = uniqueNames(files.map((f) => f.name));
  const entries: Zippable = {};
  files.forEach((f, i) => {
    const path = folder ? `${folder}/${names[i]}` : names[i];
    entries[path] = [f.bytes, { level: 0, mtime: new Date() }];
  });
  const zipped = zipSync(entries);
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}
