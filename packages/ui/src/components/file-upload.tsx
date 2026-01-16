/**
 * File Upload Component
 *
 * Drag and drop file upload with preview.
 */

"use client";

import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertCircle,
  CheckCircle2,
  File,
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Progress } from "./progress";

const dropzoneVariants = cva(
  "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors",
  {
    variants: {
      state: {
        default: "border-muted-foreground/25 hover:border-muted-foreground/50",
        active: "border-primary bg-primary/5",
        error: "border-destructive bg-destructive/5",
        disabled: "border-muted cursor-not-allowed opacity-50",
      },
      size: {
        sm: "min-h-[120px] p-4",
        default: "min-h-[180px] p-6",
        lg: "min-h-[240px] p-8",
      },
    },
    defaultVariants: {
      state: "default",
      size: "default",
    },
  }
);

interface FileWithPreview extends File {
  preview?: string;
}

interface UploadedFile {
  file: FileWithPreview;
  id: string;
  progress?: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
}

interface FileUploadProps extends VariantProps<typeof dropzoneVariants> {
  accept?: Record<string, string[]>;
  maxSize?: number; // in bytes
  maxFiles?: number;
  multiple?: boolean;
  disabled?: boolean;
  value?: UploadedFile[];
  onChange?: (files: UploadedFile[]) => void;
  onUpload?: (files: File[]) => Promise<void>;
  className?: string;
}

const FileUpload = ({
  accept,
  maxSize = 10 * 1024 * 1024, // 10MB default
  maxFiles = 5,
  multiple = true,
  disabled = false,
  value = [],
  onChange,
  onUpload,
  size,
  className,
}: FileUploadProps) => {
  const [isDragActive, setIsDragActive] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const acceptedTypes = accept
    ? Object.entries(accept)
        .flatMap(([, exts]) => exts)
        .join(", ")
    : "*";

  const handleDragEnter = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        setIsDragActive(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  }, []);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const validateFiles = (
    files: File[]
  ): { valid: File[]; errors: string[] } => {
    const valid: File[] = [];
    const errors: string[] = [];

    for (const file of files) {
      if (maxSize && file.size > maxSize) {
        errors.push(
          `${file.name} is too large. Max size is ${formatFileSize(maxSize)}`
        );
        continue;
      }

      if (accept) {
        const fileType = file.type;
        const isAccepted = Object.entries(accept).some(([mime, exts]) => {
          if (mime.endsWith("/*")) {
            return fileType.startsWith(mime.replace("/*", ""));
          }
          return (
            fileType === mime || exts.some((ext) => file.name.endsWith(ext))
          );
        });
        if (!isAccepted) {
          errors.push(`${file.name} is not an accepted file type`);
          continue;
        }
      }

      valid.push(file);
    }

    if (!multiple && valid.length > 1) {
      valid.splice(1);
    }

    if (maxFiles && value.length + valid.length > maxFiles) {
      errors.push(`Maximum ${maxFiles} files allowed`);
      valid.splice(maxFiles - value.length);
    }

    return { valid, errors };
  };

  const processFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const { valid, errors } = validateFiles(fileArray);

    if (errors.length > 0) {
      setError(errors[0] ?? null);
      setTimeout(() => setError(null), 3000);
    }

    if (valid.length === 0) return;

    const newFiles: UploadedFile[] = valid.map((file) => ({
      file: Object.assign(file, {
        preview: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      }),
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      status: "pending" as const,
    }));

    onChange?.([...value, ...newFiles]);

    if (onUpload) {
      await onUpload(valid);
    }
  };

  const handleDrop = React.useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);

      if (disabled) return;

      await processFiles(e.dataTransfer.files);
    },
    [disabled, processFiles]
  );

  const handleChange = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      await processFiles(e.target.files);
      // Reset input
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    [processFiles]
  );

  const handleRemove = (id: string) => {
    const fileToRemove = value.find((f) => f.id === id);
    if (fileToRemove?.file.preview) {
      URL.revokeObjectURL(fileToRemove.file.preview);
    }
    onChange?.(value.filter((f) => f.id !== id));
  };

  const handleClick = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  // Cleanup previews on unmount
  React.useEffect(() => {
    return () => {
      value.forEach((file) => {
        if (file.file.preview) {
          URL.revokeObjectURL(file.file.preview);
        }
      });
    };
  }, []);

  // Determine dropzone state without nested ternaries
  const getDropzoneState = () => {
    if (disabled) return "disabled";
    if (error) return "error";
    if (isDragActive) return "active";
    return "default";
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Dropzone */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        className={cn(
          dropzoneVariants({
            state: getDropzoneState(),
            size,
          }),
          "cursor-pointer"
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={acceptedTypes}
          multiple={multiple}
          disabled={disabled}
          onChange={handleChange}
          className="sr-only"
        />

        <div className="flex flex-col items-center gap-2 text-center">
          <div className="rounded-full bg-muted p-3">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {isDragActive ? "Drop files here" : "Drag & drop files here"}
            </p>
            <p className="text-xs text-muted-foreground">or click to browse</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {accept
              ? `Accepted: ${Object.values(accept).flat().join(", ")}`
              : "All file types accepted"}
            {maxSize ? ` • Max ${formatFileSize(maxSize)}` : null}
          </p>
        </div>

        {error && (
          <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}
      </div>

      {/* File list */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((uploadedFile) => (
            <FilePreview
              key={uploadedFile.id}
              uploadedFile={uploadedFile}
              onRemove={() => handleRemove(uploadedFile.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// File preview item
interface FilePreviewProps {
  uploadedFile: UploadedFile;
  onRemove: () => void;
}

const FilePreview = ({ uploadedFile, onRemove }: FilePreviewProps) => {
  const { file, status, progress, error } = uploadedFile;

  const FileIcon = getFileIcon(file.type);

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      {/* Preview/Icon */}
      <div className="relative h-10 w-10 shrink-0">
        {file.preview ? (
          <img
            src={file.preview}
            alt={file.name}
            className="h-full w-full rounded object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded bg-muted">
            <FileIcon className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatFileSize(file.size)}
        </p>
        {status === "uploading" && progress !== undefined && (
          <Progress value={progress} size="sm" className="mt-1" />
        )}
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>

      {/* Status */}
      <div className="shrink-0">
        {status === "uploading" && (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        )}
        {status === "success" && (
          <CheckCircle2 className="h-4 w-4 text-success" />
        )}
        {status === "error" && (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
      </div>

      {/* Remove */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={onRemove}
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Remove file</span>
      </Button>
    </div>
  );
};

// Helpers
function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.startsWith("audio/")) return FileAudio;
  if (mimeType.includes("pdf") || mimeType.includes("document"))
    return FileText;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export {
  dropzoneVariants,
  FilePreview,
  FileUpload,
  formatFileSize,
  type FileWithPreview,
  type UploadedFile,
};
