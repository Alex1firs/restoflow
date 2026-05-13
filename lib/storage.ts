const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024;

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return "Only JPG, PNG, or WebP images are allowed.";
  if (file.size > MAX_SIZE) return "Image must be under 5MB.";
  return null;
}

export async function uploadImage(
  file: File,
  path: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  onProgress?.(10);

  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", path);

  onProgress?.(30);

  const res = await fetch("/api/upload", { method: "POST", body: formData });

  onProgress?.(90);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Upload failed");
  }

  const { url } = await res.json();
  onProgress?.(100);
  return url;
}
