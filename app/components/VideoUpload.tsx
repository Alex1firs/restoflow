"use client";

import { useRef, useState } from "react";
import { validateVideoFile, uploadImage } from "@/lib/storage";

type Props = {
  value: string;
  onChange: (url: string) => void;
  storagePath: string;
  label?: string;
};

export default function VideoUpload({ value, onChange, storagePath, label }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(value);

  async function handleFile(file: File) {
    const err = validateVideoFile(file);
    if (err) {
      setError(err);
      return;
    }

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

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    setPreview("");
    onChange("");
  }

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
        accept="video/mp4,video/webm,video/quicktime"
        onChange={handleChange}
        className="hidden"
      />

      <div
        onClick={() => progress === null && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={`relative h-36 border-2 border-dashed rounded-xl overflow-hidden transition group ${
          progress !== null
            ? "border-orange-300 cursor-wait"
            : "border-gray-200 cursor-pointer hover:border-orange-400"
        }`}
      >
        {preview ? (
          <>
            <video
              src={preview}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            {progress === null && (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center gap-2">
                <span className="text-white text-xs font-bold opacity-0 group-hover:opacity-100 transition bg-black/60 px-3 py-1.5 rounded-lg">
                  Click to change
                </span>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="text-white text-xs font-bold opacity-0 group-hover:opacity-100 transition bg-red-600/80 hover:bg-red-600 px-3 py-1.5 rounded-lg"
                >
                  Remove
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2 px-4">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <span className="text-xs font-medium text-center">Click or drag to upload video</span>
            <span className="text-[10px] text-gray-300">MP4, WebM, MOV · Max 20MB</span>
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
