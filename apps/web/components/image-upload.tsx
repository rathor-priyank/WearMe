'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import Image from 'next/image';
import { Upload, X, AlertCircle } from 'lucide-react';
import { cn, validateImageFile, formatFileSize } from '@/lib/utils';

interface ImageUploadProps {
  label: string;
  hint: string;
  value: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

export function ImageUpload({ label, hint, value, onChange, disabled }: ImageUploadProps) {
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

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
      // Create object URL for preview
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(file));
    },
    [onChange, preview],
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
    if (preview) {
      URL.revokeObjectURL(preview);
      setPreview(null);
    }
    setError(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-neutral-300">{label}</label>
      <div
        {...getRootProps()}
        className={cn(
          'relative flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 transition-colors',
          isDragActive
            ? 'border-violet-400 bg-violet-950/30'
            : value
              ? 'border-neutral-700 bg-neutral-900'
              : 'border-neutral-700 bg-neutral-900 hover:border-neutral-600',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <input {...getInputProps()} />

        {value && preview ? (
          <div className="relative h-full w-full">
            <Image
              src={preview}
              alt={label}
              fill
              className="rounded-lg object-contain"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
            <button
              onClick={clear}
              className="absolute right-2 top-2 rounded-full bg-neutral-800 p-1 text-neutral-400 hover:bg-neutral-700 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-neutral-300">
              {value.name} · {formatFileSize(value.size)}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <Upload className="h-8 w-8 text-neutral-600" />
            <p className="text-sm text-neutral-400">
              {isDragActive ? 'Drop the image here' : 'Drag & drop or click to upload'}
            </p>
            <p className="text-xs text-neutral-600">{hint}</p>
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

