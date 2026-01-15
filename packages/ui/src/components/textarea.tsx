/**
 * Textarea Component
 *
 * A multi-line text input.
 */

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/utils";

const textareaVariants = cva(
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors",
  {
    variants: {
      variant: {
        default: "",
        error: "border-destructive focus-visible:ring-destructive",
      },
      resize: {
        none: "resize-none",
        vertical: "resize-y",
        horizontal: "resize-x",
        both: "resize",
      },
    },
    defaultVariants: {
      variant: "default",
      resize: "vertical",
    },
  },
);

export interface TextareaProps
  extends
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {
  error?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant, resize, error, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          textareaVariants({
            variant: error ? "error" : variant,
            resize,
            className,
          }),
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

// Auto-resizing textarea
interface AutoResizeTextareaProps extends TextareaProps {
  minRows?: number;
  maxRows?: number;
}

const AutoResizeTextarea = React.forwardRef<
  HTMLTextAreaElement,
  AutoResizeTextareaProps
>(({ className, minRows = 3, maxRows = 10, onChange, ...props }, ref) => {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const lineHeight = parseInt(getComputedStyle(textarea).lineHeight);
      const minHeight = lineHeight * minRows;
      const maxHeight = lineHeight * maxRows;
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = `${Math.min(Math.max(scrollHeight, minHeight), maxHeight)}px`;
    }
  }, [props.value, minRows, maxRows]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const lineHeight = parseInt(getComputedStyle(textarea).lineHeight);
      const minHeight = lineHeight * minRows;
      const maxHeight = lineHeight * maxRows;
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = `${Math.min(Math.max(scrollHeight, minHeight), maxHeight)}px`;
    }
  };

  return (
    <Textarea
      ref={(node) => {
        textareaRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      }}
      className={cn("overflow-hidden", className)}
      resize="none"
      onChange={handleChange}
      rows={minRows}
      {...props}
    />
  );
});
AutoResizeTextarea.displayName = "AutoResizeTextarea";

// Textarea with character count
interface TextareaWithCountProps extends TextareaProps {
  maxLength: number;
  showCount?: boolean;
}

const TextareaWithCount = React.forwardRef<
  HTMLTextAreaElement,
  TextareaWithCountProps
>(
  (
    { className, maxLength, showCount = true, value, defaultValue, ...props },
    ref,
  ) => {
    const [length, setLength] = React.useState(
      String(value || defaultValue || "").length,
    );

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLength(e.target.value.length);
      props.onChange?.(e);
    };

    const isOverLimit = length > maxLength;

    return (
      <div className="relative">
        <Textarea
          ref={ref}
          className={cn(isOverLimit && "border-destructive", className)}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          onChange={handleChange}
          {...props}
        />
        {showCount && (
          <div
            className={cn(
              "absolute bottom-2 right-2 text-xs",
              isOverLimit ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {length}/{maxLength}
          </div>
        )}
      </div>
    );
  },
);
TextareaWithCount.displayName = "TextareaWithCount";

export { AutoResizeTextarea, Textarea, textareaVariants, TextareaWithCount };
