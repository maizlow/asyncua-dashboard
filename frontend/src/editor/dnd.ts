/** dataTransfer type for elements dragged from the palette onto the canvas (the data is the kind) */
export const DRAG_MIME = "application/x-aud-element";
/** The kind again as a type of its own: during dragover only the types can be read, not the data */
const KIND_PREFIX = "application/x-aud-kind-";

export function setDragKind(dt: DataTransfer, kind: string) {
  dt.setData(DRAG_MIME, kind);
  dt.setData(KIND_PREFIX + kind, kind);
}

export function dragKind(types: readonly string[]): string | null {
  const t = types.find((x) => x.startsWith(KIND_PREFIX));
  return t ? t.slice(KIND_PREFIX.length) : null;
}
