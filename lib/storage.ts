const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024;

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return "Only JPG, PNG, or WebP images are allowed.";
  if (file.size > MAX_SIZE) return "Image must be under 5MB.";
  return null;
}

const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const MAX_VIDEO_SIZE = 20 * 1024 * 1024; // 20MB

export function validateVideoFile(file: File): string | null {
  if (!ALLOWED_VIDEO_TYPES.includes(file.type)) return "Only MP4, WebM, or MOV videos are allowed.";
  if (file.size > MAX_VIDEO_SIZE) return "Video must be under 20MB.";
  return null;
}

export async function uploadImage(
  file: File,
  path: string,
  onProgress?: (pct: number) => void,
  endpoint: string = "/api/upload"
): Promise<string> {
  onProgress?.(10);

  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", path);

  onProgress?.(30);

  const res = await fetch(endpoint, { method: "POST", body: formData });

  onProgress?.(90);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Upload failed");
  }

  const { url } = await res.json();
  onProgress?.(100);
  return url;
}
