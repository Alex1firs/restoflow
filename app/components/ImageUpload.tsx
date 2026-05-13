"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { validateImageFile, uploadImage } from "@/lib/storage";

type Props = {
  value: string;
  onChange: (url: string) => void;
  storagePath: string;
  label?: string;
  aspect?: "wide" | "square";
};

export default function ImageUpload({ value, onChange, storagePath, label, aspect = "wide" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(value);

  async function handleFile(file: File) {
    const err = validateImageFile(file);
    if (err) { setError(err); return; }

    setError("");
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setProgress(0);

    try {
      const url = await uploadImage(file, storagePath, setProgress);
      URL.revokeObjectURL(objectUrl);
      setPreview(url);
      onChange(url);
    } catch (err) {
      URL.revokeObjectURL(objectUrl);
      setPreview(value);
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setProgress(null);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const heightClass = aspect === "square" ? "h-48" : "h-36";

  return (
    <div>
      {label && (
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
          {label}
        </label>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleChange}
        className="hidden"
      />

      <div
        onClick={() => progress === null && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={`relative ${heightClass} border-2 border-dashed rounded-xl overflow-hidden transition group ${
          progress !== null
            ? "border-orange-300 cursor-wait"
            : "border-gray-200 cursor-pointer hover:border-orange-400"
        }`}
      >
        {preview ? (
          <>
            <Image src={preview} alt="Preview" fill className="object-cover" unoptimized />
            {progress === null && (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
                <span className="text-white text-xs font-bold opacity-0 group-hover:opacity-100 transition bg-black/60 px-3 py-1.5 rounded-lg">
                  Click to change
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2 px-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs font-medium text-center">Click or drag to upload image</span>
            <span className="text-[10px] text-gray-300">JPG, PNG, WebP · Max 5MB</span>
          </div>
        )}

        {progress !== null && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2.5">
            <div className="w-2/3 bg-white/20 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-orange-500 h-1.5 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-white text-xs font-bold">Uploading {progress}%</span>
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-500 mt-1.5 font-medium">{error}</p>
      )}
    </div>
  );
}
