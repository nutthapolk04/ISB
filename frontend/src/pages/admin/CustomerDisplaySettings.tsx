/**
 * Customer Display Settings — admin-only page for managing the standby
 * image rotation shown on the second-monitor customer screen.
 *
 * Upload, drag to reorder, click to delete. Hard cap of 10 images, 2 MB
 * per file, JPG or PNG. The endpoint at /api/v1/admin/customer-display/*
 * enforces every limit on the server side too.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Monitor, Upload, Trash2, GripVertical, Loader2 } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { api, ApiError } from "@/lib/api";
import { API_BASE_URL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ── Types ──────────────────────────────────────────────────────────────────

interface DisplayImage {
  id: number;
  content_type: string;
  filename: string | null;
  size_bytes: number;
  sort_order: number;
  uploaded_at: string;
}

const MAX_IMAGES = 10;
const MAX_MB = 2;

// ── Sortable thumbnail tile ────────────────────────────────────────────────

function SortableThumb({
  image,
  onDelete,
}: {
  image: DisplayImage;
  onDelete: (img: DisplayImage) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(image.id) });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  // Full backend URL — relative path would hit the Vercel host, where
  // /api/v1/* is not proxied, so the image would 404.
  const imgUrl = `${API_BASE_URL}/customer-display/images/${image.id}/binary`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative group rounded-lg overflow-hidden border border-border bg-muted aspect-video shadow-sm"
    >
      <img
        src={imgUrl}
        alt={image.filename ?? `Image ${image.id}`}
        className="w-full h-full object-cover"
        loading="lazy"
      />
      {/* Drag handle — top-left */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute top-1 left-1 rounded bg-black/50 p-1 text-white opacity-0 group-hover:opacity-100 transition cursor-grab active:cursor-grabbing"
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {/* Delete — top-right */}
      <button
        type="button"
        onClick={() => onDelete(image)}
        className="absolute top-1 right-1 rounded bg-red-600 p-1 text-white opacity-0 group-hover:opacity-100 transition hover:bg-red-700"
        title="Delete image"
        aria-label="Delete image"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {/* Filename footer */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[11px] text-white truncate">
        {image.filename ?? `Image ${image.id}`} · {(image.size_bytes / 1024).toFixed(0)} KB
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CustomerDisplaySettings() {
  const [images, setImages] = useState<DisplayImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DisplayImage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchImages = async () => {
    setLoading(true);
    try {
      const data = await api.get<DisplayImage[]>("/customer-display/images");
      setImages(data);
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to load images");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  // ── Upload ───────────────────────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file
    if (!file) return;

    // Client-side validation matching the backend caps so we can show a
    // nice toast before round-tripping.
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      toast.error("Only JPG and PNG images are supported.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`File too large. Maximum size is ${MAX_MB} MB.`);
      return;
    }
    if (images.length >= MAX_IMAGES) {
      toast.error(`Maximum ${MAX_IMAGES} images allowed. Delete one first.`);
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.postFormData("/admin/customer-display/images", form);
      toast.success("Image uploaded.");
      await fetchImages();
    } catch (err: any) {
      const detail =
        err instanceof ApiError ? err.detail : err?.message ?? "Upload failed";
      toast.error(String(detail));
    } finally {
      setUploading(false);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/customer-display/images/${deleteTarget.id}`);
      toast.success("Image deleted.");
      setDeleteTarget(null);
      await fetchImages();
    } catch (err: any) {
      toast.error(err?.detail ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  // ── Reorder ──────────────────────────────────────────────────────────────
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = images.findIndex((i) => String(i.id) === active.id);
    const newIndex = images.findIndex((i) => String(i.id) === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(images, oldIndex, newIndex);
    setImages(reordered); // optimistic
    try {
      await api.patch("/admin/customer-display/images/order", {
        ordered_ids: reordered.map((i) => i.id),
      });
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to save new order");
      await fetchImages(); // revert to server truth
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="page-shell">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/admin">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Monitor className="h-6 w-6 text-amber-500" />
              Customer Display
            </h1>
            <p className="text-sm text-muted-foreground">
              Standby images shown on the second-monitor customer screen
              between transactions. Rotates every 5 seconds.
            </p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleUpload}
          className="hidden"
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || images.length >= MAX_IMAGES}
          className="gap-2"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Upload Image
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Images ({images.length} / {MAX_IMAGES})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Landscape only · 1920×1080 (16:9) recommended · JPG / PNG · max {MAX_MB} MB ·
            portrait images will be cropped. Drag the handle to reorder.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Monitor className="h-10 w-10 mb-2 opacity-40" />
              <p className="text-sm">No images uploaded yet.</p>
              <p className="text-xs mt-1">
                Upload your first image to start the standby rotation.
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={images.map((i) => String(i.id))}
                strategy={rectSortingStrategy}
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {images.map((img) => (
                    <SortableThumb
                      key={img.id}
                      image={img}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this image?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove{" "}
              <b>{deleteTarget?.filename ?? `Image ${deleteTarget?.id}`}</b>{" "}
              from the standby rotation. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
