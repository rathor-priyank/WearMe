'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import Image from 'next/image';
import { Upload, X, AlertCircle, ImageIcon } from 'lucide-react';
import { cn, validateImageFile, formatFileSize } from '@/lib/utils';

interface ImageUploadProps {
  label: string;
  hint: string;
  value: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  badge?: string;
}

export function ImageUpload({
  label,
  hint,
  value,
  onChange,
  disabled,
  badge,
}: ImageUploadProps) {
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  // Synchronize preview object URL with controlled `value` prop and revoke on cleanup
  useEffect(() => {
    if (!value) {
      setPreview(null);
      setDimensions(null);
      return;
    }

    const objectUrl = URL.createObjectURL(value);
    setPreview(objectUrl);

    const img = new window.Image();
    img.onload = () => {
      setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = objectUrl;

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [value]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      const validationError = validateImageFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      setError(null);
      onChange(file);
    },
    [onChange],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/jpeg': [], 'image/png': [], 'image/webp': [] },
    maxFiles: 1,
    disabled,
  });

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setError(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-neutral-200">{label}</label>
        {badge && (
          <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-neutral-400">
            {badge}
          </span>
        )}
      </div>

      <div
        {...getRootProps()}
        className={cn(
          'relative flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 transition-all',
          isDragActive
            ? 'border-violet-400 bg-violet-950/30'
            : value
              ? 'border-violet-800/60 bg-neutral-900/90'
              : 'border-neutral-800 bg-neutral-900/60 hover:border-neutral-700 hover:bg-neutral-900',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <input {...getInputProps()} />

        {value && preview ? (
          <div className="relative h-52 w-full">
            <Image
              src={preview}
              alt={label}
              fill
              className="rounded-lg object-contain"
              sizes="(max-width: 768px) 100vw, 50vw"
              unoptimized
            />
            {!disabled && (
              <button
                type="button"
                onClick={clear}
                title="Remove image"
                className="absolute right-2 top-2 rounded-full border border-neutral-700 bg-neutral-900/90 p-1.5 text-neutral-300 shadow hover:bg-neutral-800 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 rounded-md bg-black/75 px-2.5 py-1 text-xs text-neutral-200 backdrop-blur-sm">
              <span className="truncate font-medium">{value.name}</span>
              <span className="shrink-0 text-neutral-400">
                {dimensions ? `${dimensions.width}×${dimensions.height}px · ` : ''}
                {formatFileSize(value.size)}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2.5 px-3 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-violet-400">
              {isDragActive ? <ImageIcon className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
            </div>
            <p className="text-sm font-medium text-neutral-300">
              {isDragActive ? 'Drop image here' : 'Drag & drop or click to choose'}
            </p>
            <p className="max-w-xs text-xs leading-relaxed text-neutral-500">{hint}</p>
            <p className="text-[11px] text-neutral-600">JPEG, PNG, or WebP · 64px–4096px · Max 10 MB</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

