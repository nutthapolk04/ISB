import type { SyntheticEvent } from "react";

/** Default avatar when a user has no photo or the image fails to load. */
export const DEFAULT_AVATAR_URL = "/isb-logo.svg";

export function getFallbackAvatar(_seed?: string | null): string {
  return DEFAULT_AVATAR_URL;
}

export function resolveAvatarUrl(
  photoUrl: string | null | undefined,
  _seed?: string | null,
): string {
  const trimmed = photoUrl?.trim();
  if (trimmed && /^https?:\/\//.test(trimmed)) return trimmed;
  return DEFAULT_AVATAR_URL;
}

/** Use on <img onError> / AvatarImage onError when the remote photo fails. */
export function handleAvatarImageError(
  e: SyntheticEvent<HTMLImageElement, Event>,
): void {
  const el = e.currentTarget;
  if (!el.src.includes("isb-logo.svg")) {
    el.src = DEFAULT_AVATAR_URL;
  }
}
