import { asc, eq } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { customerDisplayImages } from "@/db/schema";
import { pgToIso } from "@/lib/dates";

export interface CustomerDisplayImageDTO {
  id: number;
  content_type: string;
  filename: string | null;
  size_bytes: number;
  sort_order: number;
  uploaded_at: string;
  uploaded_by: number | null;
}

export async function listImages(): Promise<CustomerDisplayImageDTO[]> {
  const rows = await db
    .select({
      id: customerDisplayImages.id,
      content_type: customerDisplayImages.contentType,
      filename: customerDisplayImages.filename,
      size_bytes: customerDisplayImages.sizeBytes,
      sort_order: customerDisplayImages.sortOrder,
      uploaded_at: customerDisplayImages.uploadedAt,
      uploaded_by: customerDisplayImages.uploadedBy,
    })
    .from(customerDisplayImages)
    .orderBy(asc(customerDisplayImages.sortOrder), asc(customerDisplayImages.id));

  return rows.map((r) => ({
    id: r.id,
    content_type: r.content_type,
    filename: r.filename ?? null,
    size_bytes: r.size_bytes,
    sort_order: r.sort_order,
    uploaded_at: pgToIso(r.uploaded_at)!,
    uploaded_by: r.uploaded_by ?? null,
  }));
}

export interface ImageBinary {
  content: Buffer;
  contentType: string;
  sizeBytes: number;
}

export async function getImageBinary(imageId: number): Promise<ImageBinary> {
  // Raw query for bytea — Drizzle returns Buffer via postgres-js.
  const rows = await pgClient<Array<{ data: Buffer; content_type: string; size_bytes: number }>>`
    SELECT data, content_type, size_bytes FROM customer_display_images WHERE id = ${imageId}
  `;
  if (!rows[0]) {
    const err = new Error("Image not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return { content: rows[0].data, contentType: rows[0].content_type, sizeBytes: rows[0].size_bytes };
}

export async function reorderImages(orderedIds: number[]): Promise<{ success: true; updated: number }> {
  let updated = 0;
  await pgClient.begin(async (sqlTx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      const res = await sqlTx<Array<{ id: number }>>`
        UPDATE customer_display_images SET sort_order = ${i} WHERE id = ${id} RETURNING id
      `;
      if (res.length > 0) updated += 1;
    }
  });
  return { success: true, updated };
}

const MAX_IMAGES = 10;
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);

export async function uploadImage(args: {
  file: File;
  userId: number;
}): Promise<CustomerDisplayImageDTO> {
  const { file, userId } = args;

  // Cap check first — fail fast before reading the body.
  const countRows = await pgClient<Array<{ c: string }>>`SELECT COUNT(*)::text AS c FROM customer_display_images`;
  const currentCount = Number(countRows[0]?.c ?? 0);
  if (currentCount >= MAX_IMAGES) {
    const err = new Error(`Maximum ${MAX_IMAGES} images allowed. Delete one before uploading.`);
    (err as { status?: number }).status = 422;
    throw err;
  }

  const contentType = file.type;
  if (!ALLOWED_TYPES.has(contentType)) {
    const err = new Error("Only JPG and PNG images are supported.");
    (err as { status?: number }).status = 422;
    throw err;
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) {
    const err = new Error("Uploaded file is empty.");
    (err as { status?: number }).status = 422;
    throw err;
  }
  if (buf.length > MAX_BYTES) {
    const err = new Error(`File too large. Maximum size is ${Math.floor(MAX_BYTES / (1024 * 1024))} MB.`);
    (err as { status?: number }).status = 422;
    throw err;
  }

  // New image lands at the end of the rotation.
  const lastRows = await pgClient<Array<{ sort_order: number }>>`
    SELECT sort_order FROM customer_display_images ORDER BY sort_order DESC LIMIT 1
  `;
  const nextOrder = lastRows[0] ? lastRows[0].sort_order + 1 : 0;

  const filename = file.name ?? null;
  const inserted = await pgClient<Array<{ id: number; uploaded_at: string }>>`
    INSERT INTO customer_display_images
      (data, content_type, filename, size_bytes, sort_order, uploaded_by)
    VALUES (${buf}, ${contentType}, ${filename}, ${buf.length}, ${nextOrder}, ${userId})
    RETURNING id, uploaded_at
  `;
  return {
    id: inserted[0].id,
    content_type: contentType,
    filename,
    size_bytes: buf.length,
    sort_order: nextOrder,
    uploaded_at: pgToIso(inserted[0].uploaded_at)!,
    uploaded_by: userId,
  };
}

export async function deleteImage(imageId: number): Promise<void> {
  const res = await pgClient<Array<{ id: number }>>`
    DELETE FROM customer_display_images WHERE id = ${imageId} RETURNING id
  `;
  if (!res[0]) {
    const err = new Error("Image not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
}
