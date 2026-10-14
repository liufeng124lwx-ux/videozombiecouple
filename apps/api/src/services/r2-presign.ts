import { AwsClient } from "aws4fetch";
import { filesProxied, fileUrl } from "../files.ts";
import { isLocal, localUrl } from "../local.ts";
import type { Bindings } from "../types.ts";

/**
 * A query-signed R2 URL (S3 API). The bucket is private: browsers upload with PUT and kie and
 * browsers read with GET through these links only (spec 1.3, 3.2).
 */
export async function presign(
  env: Bindings,
  key: string,
  method: "GET" | "PUT",
  expiresSec: number,
  /** Headers the request must carry exactly, e.g. the declared size and type of an upload. */
  signedHeaders: Record<string, string> = {},
): Promise<string> {
  if (isLocal(env)) return localUrl(env, key, method, expiresSec);
  if (filesProxied(env)) return fileUrl(env, key, method, expiresSec, signedHeaders);
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`,
  );
  url.searchParams.set("X-Amz-Expires", String(expiresSec));
  const signed = await client.sign(url.toString(), {
    method,
    headers: signedHeaders,
    // aws4fetch skips content-length and content-type unless told to sign every header.
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}
