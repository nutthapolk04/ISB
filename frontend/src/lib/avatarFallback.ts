export function getFallbackAvatar(seed: string | null | undefined): string {
  const s = encodeURIComponent(seed || "unknown");
  return `https://i.pravatar.cc/150?u=${s}`;
}

export function resolveAvatarUrl(
  photoUrl: string | null | undefined,
  seed: string | null | undefined,
): string {
  if (photoUrl && /^https?:\/\//.test(photoUrl)) return photoUrl;
  return getFallbackAvatar(seed);
}
