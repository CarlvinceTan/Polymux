import {createHash, createHmac} from "node:crypto";
import {readFile, stat} from "node:fs/promises";
import path from "node:path";
import type {DriveEntryDto, DriveS3ConfigRequest} from "@polymux/protocol";
import {fileChunks, SIMPLE_UPLOAD_LIMIT} from "./chunks.js";
import {downloadToFile, etagAsMd5} from "./download.js";
import {DriveRequestError, request} from "./http.js";
import {
  copyName,
  DriveConflictError,
  type DriveAdapter,
  type DriveProbe,
  type DriveSecretStore,
  type DriveWriteOptions,
} from "./types.js";

const CREDENTIAL_ID = "drive:s3:secret";
const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Everything about an S3 connection except the secret key. */
export type S3Settings = Omit<DriveS3ConfigRequest, "secretAccessKey">;

/**
 * Any S3-compatible bucket.
 *
 * Requests are signed with SigV4 here rather than through the AWS SDK: the
 * handful of operations a drive needs is far less code than the SDK would add
 * to the packaged app, and it keeps R2, Backblaze and MinIO working through the
 * same path as AWS.
 *
 * S3 has no folders. A prefix ending in `/` is presented as one, which is the
 * same fiction every S3 browser tells.
 */
export class S3Drive implements DriveAdapter {
  readonly id = "s3" as const;
  readonly #secrets: DriveSecretStore;
  #settings: S3Settings | null;

  constructor(secrets: DriveSecretStore, settings: S3Settings | null) {
    this.#secrets = secrets;
    this.#settings = settings;
  }

  settings(): S3Settings | null {
    return this.#settings;
  }

  /** Saves the connection. An omitted secret keeps the stored one, so editing
   * the region does not require retyping the key. */
  async configure(config: DriveS3ConfigRequest): Promise<void> {
    const {secretAccessKey, ...rest} = config;
    if (secretAccessKey) await this.#secrets.write(CREDENTIAL_ID, secretAccessKey);
    else if (!(await this.#secrets.read(CREDENTIAL_ID)))
      throw new Error("A secret access key is required.");
    this.#settings = rest;
  }

  async probe(): Promise<DriveProbe> {
    if (!this.#settings)
      return {state: "logged-out", accounts: [], usage: null, root: null, error: null};
    if (!(await this.#secrets.read(CREDENTIAL_ID)))
      return {
        state: "logged-out",
        accounts: [],
        usage: null,
        root: this.#settings.bucket,
        error: null,
      };
    try {
      // A zero-key listing is the cheapest call that proves both the
      // credentials and the bucket name are right.
      await this.#send("GET", "", {"list-type": "2", "max-keys": "0"});
      return {
        state: "connected",
        accounts: [
          {
            id: this.#settings.bucket,
            name: this.#settings.bucket,
            email: null,
          },
        ],
        // S3 has no quota to report, and a made-up number would be worse than
        // the absence of one.
        usage: null,
        root: this.#settings.prefix
          ? `${this.#settings.bucket}/${this.#settings.prefix}`
          : this.#settings.bucket,
        error: null,
      };
    } catch (cause) {
      return {
        state: "error",
        accounts: [],
        usage: null,
        root: this.#settings.bucket,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  async disconnect(): Promise<void> {
    await this.#secrets.clear(CREDENTIAL_ID);
    this.#settings = null;
  }

  async list(target: string): Promise<DriveEntryDto[]> {
    const prefix = this.#key(target);
    const entries: DriveEntryDto[] = [];
    let token: string | undefined;
    do {
      const response = await this.#send("GET", "", {
        "list-type": "2",
        prefix,
        // The delimiter is what makes S3 answer with folders instead of every
        // key in the bucket.
        delimiter: "/",
        ...(token ? {"continuation-token": token} : {}),
      });
      const body = await response.text();
      for (const folder of matchAll(body, "CommonPrefixes")) {
        const key = tag(folder, "Prefix");
        if (!key) continue;
        entries.push({
          id: key,
          name: basename(key),
          kind: "folder",
          size: null,
          modifiedAt: null,
          provider: this.id,
          path: this.#relative(key),
          mimeType: null,
        });
      }
      for (const object of matchAll(body, "Contents")) {
        const key = tag(object, "Key");
        // The placeholder object that makes an empty folder exist is not a
        // file the user put there.
        if (!key || key === prefix || key.endsWith("/")) continue;
        entries.push({
          id: key,
          name: basename(key),
          kind: "file",
          size: Number(tag(object, "Size") ?? "0"),
          modifiedAt: tag(object, "LastModified") ?? null,
          provider: this.id,
          path: this.#relative(key),
          mimeType: null,
        });
      }
      token =
        tag(body, "IsTruncated") === "true"
          ? (tag(body, "NextContinuationToken") ?? undefined)
          : undefined;
    } while (token);
    return entries;
  }

  async createFolder(parentPath: string, name: string): Promise<DriveEntryDto> {
    const key = `${this.#key(parentPath)}${name}/`;
    // A folder is an empty object whose key ends in a slash — the only way to
    // make one exist before it holds anything.
    await this.#send("PUT", key, undefined, Buffer.alloc(0));
    return {
      id: key,
      name,
      kind: "folder",
      size: null,
      modifiedAt: new Date().toISOString(),
      provider: this.id,
      path: this.#relative(key),
      mimeType: null,
    };
  }

  async upload(
    parentPath: string,
    localPath: string,
    options?: DriveWriteOptions,
  ): Promise<DriveEntryDto> {
    const name = path.basename(localPath);
    const key = `${this.#key(parentPath)}${name}`;
    const size = (await stat(localPath)).size;
    // S3 states the condition on the request itself, so the check and the
    // write are one operation: there is no window between them for another
    // writer to slip through, and a bucket reached from somewhere else entirely
    // is covered by the same guarantee.
    const conditional = conditionHeaders(options);
    const written = await this.#conditionally(key, options, async () =>
      size > SIMPLE_UPLOAD_LIMIT
        ? this.#uploadParts(localPath, key, conditional)
        : this.#send(
            "PUT",
            key,
            undefined,
            await readFile(localPath),
            conditional,
          ),
    );
    options?.onProgress?.(size, size);
    return {
      id: key,
      name,
      kind: "file",
      size,
      modifiedAt: new Date().toISOString(),
      provider: this.id,
      path: this.#relative(key),
      mimeType: null,
      version: written.headers.get("etag"),
    };
  }

  readonly conditionalWrites = true;

  childPath(parentPath: string, name: string): string {
    return this.#relative(`${this.#key(parentPath)}${name}`);
  }

  /**
   * Turns S3's refusal into the drive's own conflict.
   *
   * A precondition that fails is a 412, and on the completion of a multipart
   * upload it can also arrive as a 409 — the same answer, phrased for a
   * different endpoint. Everything else is an ordinary failure and is left
   * alone, because "the upload broke" and "somebody else changed this" call for
   * different things from the caller.
   */
  async #conditionally(
    key: string,
    options: DriveWriteOptions | undefined,
    work: () => Promise<Response>,
  ): Promise<Response> {
    try {
      return await work();
    } catch (cause) {
      if (
        options?.ifMatch &&
        cause instanceof DriveRequestError &&
        (cause.status === 412 || cause.status === 409)
      )
        throw new DriveConflictError({
          path: this.#relative(key),
          expected: options.ifMatch,
          found: await this.version(this.#relative(key)).catch(
            (): null => null,
          ),
        });
      throw cause;
    }
  }

  /** The object's ETag, from a metadata request rather than its bytes. */
  async version(target: string): Promise<string | null> {
    try {
      const response = await this.#send("HEAD", this.#key(target));
      return response.headers.get("etag");
    } catch {
      // A key that is not there is not a failure to report: nothing is being
      // replaced, so the write is unconditional by definition.
      return null;
    }
  }

  /**
   * A multipart upload: create, one request per part, complete.
   *
   * The abort on failure is not tidiness — S3 keeps the parts of an unfinished
   * upload and bills for them indefinitely, so an upload that dies without it
   * leaves the user paying for bytes no listing will ever show them.
   */
  async #uploadParts(
    localPath: string,
    key: string,
    conditional?: Record<string, string>,
  ): Promise<Response> {
    const created = await this.#send("POST", key, {uploads: ""});
    const uploadId = tag(await created.text(), "UploadId");
    if (!uploadId) throw new Error("S3 did not open a multipart upload.");

    try {
      const parts: {number: number; etag: string}[] = [];
      for await (const chunk of fileChunks(localPath)) {
        const number = parts.length + 1;
        const response = await this.#send(
          "PUT",
          key,
          {partNumber: String(number), uploadId},
          chunk.bytes,
        );
        const etag = response.headers.get("etag");
        if (!etag) throw new Error("S3 did not acknowledge a part.");
        parts.push({number, etag});
      }
      const body = `<CompleteMultipartUpload>${parts
        .map(
          (part) =>
            `<Part><PartNumber>${part.number}</PartNumber><ETag>${part.etag}</ETag></Part>`,
        )
        .join("")}</CompleteMultipartUpload>`;
      // The condition rides on the completion rather than on each part: the
      // parts are staged under the upload id and are not the object yet, so
      // completing is the moment the old version would be replaced.
      const completed = await this.#send(
        "POST",
        key,
        {uploadId},
        Buffer.from(body),
        conditional,
      );
      // S3 answers 200 and then fails inside the body, which is the one place
      // where a successful status is not a successful upload.
      const text = await completed.text();
      if (!text.includes("<CompleteMultipartUploadResult"))
        throw new Error(
          `The upload could not be completed: ${tag(text, "Message") ?? text.slice(0, 200)}`,
        );
      return completed;
    } catch (cause) {
      await this.#send("DELETE", key, {uploadId}).catch(
        (): undefined => undefined,
      );
      throw cause;
    }
  }

  async download(target: string, destination: string): Promise<void> {
    const key = this.#key(target, false);
    await downloadToFile(destination, {
      // Both come back on the response itself, so a download costs one call.
      describe: (response) => {
        const md5 = etagAsMd5(response.headers.get("etag"));
        const length = Number(response.headers.get("content-length"));
        return {
          // A 206 states the length of the part, not of the object, so it is
          // only the whole file's size on the first, unranged response.
          size:
            response.status === 200 && Number.isFinite(length) ? length : null,
          hash: md5 ? {algorithm: "md5", expected: md5} : null,
        };
      },
      open: async (offset) =>
        this.#send(
          "GET",
          key,
          undefined,
          undefined,
          offset > 0 ? {range: `bytes=${offset}-`} : undefined,
        ),
    });
  }

  async remove(target: string): Promise<void> {
    const key = this.#key(target, false);
    if (!key.endsWith("/")) {
      await this.#send("DELETE", key);
      return;
    }
    // Deleting a folder means deleting everything under its prefix; the
    // prefix itself is not an object that owns them.
    let token: string | undefined;
    do {
      const response = await this.#send("GET", "", {
        "list-type": "2",
        prefix: key,
        ...(token ? {"continuation-token": token} : {}),
      });
      const body = await response.text();
      for (const object of matchAll(body, "Contents")) {
        const child = tag(object, "Key");
        if (child) await this.#send("DELETE", child);
      }
      token =
        tag(body, "IsTruncated") === "true"
          ? (tag(body, "NextContinuationToken") ?? undefined)
          : undefined;
    } while (token);
  }

  async rename(target: string, name: string): Promise<DriveEntryDto> {
    const from = this.#key(target, false);
    if (from.endsWith("/"))
      throw new Error("Renaming a folder is not supported on S3 storage.");
    const to = `${from.slice(0, from.lastIndexOf("/") + 1)}${name}`;
    // S3 has no rename: the object is copied to the new key and the old one
    // deleted, which is what every S3 client does.
    await this.#copyObject(from, to);
    await this.#send("DELETE", from);
    return this.#describe(to, name);
  }

  async move(target: string, destinationFolder: string): Promise<DriveEntryDto> {
    const from = this.#key(target, false);
    if (from.endsWith("/"))
      throw new Error("Moving a folder is not supported on S3 storage.");
    const name = basename(from);
    const to = `${this.#key(destinationFolder)}${name}`;
    if (to === from) return this.#describe(to, name);
    await this.#copyObject(from, to);
    await this.#send("DELETE", from);
    return this.#describe(to, name);
  }

  async copy(target: string): Promise<DriveEntryDto> {
    const from = this.#key(target, false);
    if (from.endsWith("/"))
      throw new Error("Duplicating a folder is not supported on S3 storage.");
    const name = copyName(basename(from));
    const to = `${from.slice(0, from.lastIndexOf("/") + 1)}${name}`;
    await this.#copyObject(from, to);
    return this.#describe(to, name);
  }

  /** A server-side copy: the bytes never come through this Mac. */
  async #copyObject(from: string, to: string): Promise<void> {
    const settings = this.#require();
    await this.#send("PUT", to, undefined, Buffer.alloc(0), {
      // The source is a bucket-qualified key, and it has to be escaped the
      // same way the canonical URI is or a key with spaces fails to verify.
      "x-amz-copy-source": `/${settings.bucket}/${from
        .split("/")
        .map(encodeRfc3986)
        .join("/")}`,
    });
  }

  #describe(key: string, name: string): DriveEntryDto {
    return {
      id: key,
      name,
      kind: "file",
      size: null,
      modifiedAt: new Date().toISOString(),
      provider: this.id,
      path: this.#relative(key),
      mimeType: null,
    };
  }

  /** The full object key for a caller's path, with the configured prefix
   * applied. Folder keys keep their trailing slash. */
  #key(target: string, directory = true): string {
    const settings = this.#require();
    const base = settings.prefix
      ? `${settings.prefix.replace(/^\/+|\/+$/g, "")}/`
      : "";
    const cleaned = target.replace(/^\/+/, "");
    const key = `${base}${cleaned}`;
    if (!directory) return key;
    return key === "" || key.endsWith("/") ? key : `${key}/`;
  }

  /** Strips the configured prefix back off, so paths handed upward stay
   * relative to the drive's root rather than the bucket's. */
  #relative(key: string): string {
    const settings = this.#require();
    if (!settings.prefix) return key;
    const base = `${settings.prefix.replace(/^\/+|\/+$/g, "")}/`;
    return key.startsWith(base) ? key.slice(base.length) : key;
  }

  #require(): S3Settings {
    if (!this.#settings) throw new Error("S3 storage is not configured.");
    return this.#settings;
  }

  /**
   * Signs and sends one request.
   *
   * SigV4 is a canonical request hashed into a string-to-sign, signed with a
   * key derived from date, region and service. Every part of it is fixed by the
   * spec, so the order and the exact encoding below are not stylistic.
   */
  async #send(
    method: string,
    key: string,
    query?: Record<string, string>,
    body?: Buffer,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const settings = this.#require();
    const secret = await this.#secrets.read(CREDENTIAL_ID);
    if (!secret) throw new Error("S3 storage has no secret access key stored.");

    const endpoint = settings.endpoint
      ? new URL(
          settings.endpoint.startsWith("http")
            ? settings.endpoint
            : `https://${settings.endpoint}`,
        )
      : new URL(`https://s3.${settings.region}.amazonaws.com`);
    // Virtual-host addressing puts the bucket in the hostname; most
    // S3-compatible services only understand the path form.
    const host =
      settings.forcePathStyle || settings.endpoint
        ? endpoint.host
        : `${settings.bucket}.${endpoint.host}`;
    const basePath =
      settings.forcePathStyle || settings.endpoint
        ? `/${settings.bucket}`
        : "";
    const canonicalUri = `${basePath}/${key.split("/").map(encodeRfc3986).join("/")}`;

    const canonicalQuery = Object.keys(query ?? {})
      .sort()
      .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(query![name])}`)
      .join("&");

    const now = new Date();
    const amzDate = `${now.toISOString().replace(/[-:]|\.\d{3}/g, "")}`;
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = body
      ? createHash("sha256").update(body).digest("hex")
      : EMPTY_SHA256;

    const headers: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...Object.fromEntries(
        Object.entries(extraHeaders ?? {}).map(([name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      ),
    };
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${headers[name].trim()}\n`)
      .join("");
    const signedHeaders = signedHeaderNames.join(";");

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${settings.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const signingKey = ["aws4_request"].reduce(
      (key, part) => hmac(key, part),
      hmac(hmac(hmac(`AWS4${secret}`, dateStamp), settings.region), "s3"),
    );
    const signature = createHmac("sha256", signingKey)
      .update(stringToSign)
      .digest("hex");

    const url = `${endpoint.protocol}//${host}${canonicalUri}${
      canonicalQuery ? `?${canonicalQuery}` : ""
    }`;
    // The signature covers this exact request, so a retry has to be the same
    // bytes with the same timestamp — which is what `request` sends.
    return request(
      url,
      {
        method,
        headers: {
          ...headers,
          authorization: `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
        body: body && body.byteLength > 0 ? new Uint8Array(body) : undefined,
      },
      "The S3 request",
    );
  }
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

/**
 * S3 signs against RFC 3986, which `encodeURIComponent` almost implements —
 * it leaves `!'()*` alone, and a key containing one would fail to verify.
 */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** ListObjectsV2 answers in a small, flat XML dialect. Pulling the handful of
 * tags out of it beats adding an XML parser to the app. */
function matchAll(body: string, name: string): string[] {
  return [...body.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map(
    (match) => match[1],
  );
}

function tag(body: string, name: string): string | null {
  return new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)?.[1] ?? null;
}

function basename(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/**
 * The header that makes the write conditional.
 *
 * `If-Match` on a PUT is S3's own compare-and-swap: the object is replaced only
 * while its ETag is still the one the caller read. No expectation means an
 * ordinary unconditional write.
 */
function conditionHeaders(
  options?: DriveWriteOptions,
): Record<string, string> | undefined {
  return options?.ifMatch ? {"if-match": options.ifMatch} : undefined;
}
