import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { logger } from "@/lib/logger";
import type { S3ObjectInfo, SyncConfiguration } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_KEYS_FOR_RECEIPT_LISTING = 2;

// ─── KV S3 Client ─────────────────────────────────────────────────────────────

export class KvS3Client {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(configuration: SyncConfiguration) {
    this.bucketName = configuration.kvReceiptS3BucketName;

    const accessKeyId = process.env.KV_RECEIPT_AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.KV_RECEIPT_AWS_SECRET_ACCESS_KEY;

    const clientOptions: ConstructorParameters<typeof S3Client>[0] = {
      region: configuration.kvReceiptAwsRegion,
    };

    if (accessKeyId && secretAccessKey) {
      clientOptions.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }

    this.s3Client = new S3Client(clientOptions);
  }

  async listReceiptObjects(reviewId: string): Promise<ReadonlyArray<S3ObjectInfo>> {
    const prefix = `${reviewId}.`;

    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: prefix,
      MaxKeys: MAX_KEYS_FOR_RECEIPT_LISTING,
    });

    try {
      const response = await this.s3Client.send(command);
      const contents = response.Contents;

      if (!contents || contents.length === 0) {
        return [];
      }

      const objects: S3ObjectInfo[] = [];
      for (const item of contents) {
        if (item.Key && item.ETag) {
          objects.push({
            key: item.Key,
            etag: item.ETag,
            size: item.Size || 0,
          });
        }
      }

      return objects;
    } catch (error: unknown) {
      logger.error(
        { reviewId, prefix, error },
        "Failed to list S3 objects for receipt"
      );
      throw error;
    }
  }

  async getReceiptContent(s3Key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    try {
      const response = await this.s3Client.send(command);
      const stream = response.Body as NodeJS.ReadableStream;
      const chunks: Buffer[] = [];

      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }

      return Buffer.concat(chunks);
    } catch (error: unknown) {
      logger.error(
        { s3Key, error },
        "Failed to get receipt content from S3"
      );
      throw error;
    }
  }
}
