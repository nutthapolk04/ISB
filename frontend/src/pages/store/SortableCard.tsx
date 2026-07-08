import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ── Sortable card wrapper (must be defined outside Store to avoid hook remounts) ──

export function SortableCard({
    id,
    reorderMode,
    children,
}: {
    id: number;
    reorderMode: boolean;
    children: (handleProps: React.HTMLAttributes<HTMLElement>, isDragging: boolean) => React.ReactNode;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: String(id) });
    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                opacity: isDragging ? 0.4 : 1,
                position: "relative",
                // Disable native touch gestures only while reorder mode is on,
                // so cashier scrolling the catalogue normally still works. Once
                // they enter reorder mode, holding a card for ~250 ms (matches
                // TouchSensor's delay) initiates drag instead of scroll.
                touchAction: reorderMode ? "none" : "auto",
            }}
        >
            {children(reorderMode ? { ...attributes, ...listeners } : {}, isDragging)}
        </div>
    );
}
