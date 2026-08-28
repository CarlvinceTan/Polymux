import {extract} from "tar";

/** Extracts a downloaded gzip tarball without relying on a host `tar` CLI. */
export async function extractTarGzip(
  archive: string,
  destination: string,
): Promise<void> {
  await extract({
    file: archive,
    cwd: destination,
    gzip: true,
    preservePaths: false,
    strict: true,
  });
}
