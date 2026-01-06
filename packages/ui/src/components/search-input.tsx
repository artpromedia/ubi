"use client";

import { Search, X } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils";

/**
 * SearchInput - Search input with icon and clear button
 *
 * @example
 * <SearchInput
 *   placeholder="Search restaurants..."
 *   value={query}
 *   onChange={setQuery}
 *   onClear={() => setQuery("")}
 * />
 */

export interface SearchInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange" | "size"
> {
  /** Controlled value */
  value?: string;
  /** Change handler */
  onChange?: (value: string) => void;
  /** Called when clear button is clicked */
  onClear?: () => void;
  /** Called when search is submitted (Enter key) */
  onSearch?: (value: string) => void;
  /** Show loading state */
  loading?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      className,
      value,
      onChange,
      onClear,
      onSearch,
      loading,
      size = "md",
      ...props
    },
    ref
  ) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && value) {
        onSearch?.(value);
      }
      if (e.key === "Escape") {
        onClear?.();
      }
    };

    const sizeClasses = {
      sm: "h-8 text-sm",
      md: "h-10",
      lg: "h-12 text-lg",
    };

    return (
      <div className="relative">
        <Search
          className={cn(
            "absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground",
            size === "sm" && "h-4 w-4",
            size === "md" && "h-5 w-5",
            size === "lg" && "h-6 w-6",
            loading && "animate-pulse"
          )}
        />
        <input
          ref={ref}
          type="search"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex w-full rounded-lg border border-input bg-background pl-10 pr-10 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            sizeClasses[size],
            className
          )}
          {...props}
        />
        {value && (
          <button
            type="button"
            onClick={onClear}
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors",
              size === "sm" && "h-4 w-4",
              size === "md" && "h-5 w-5",
              size === "lg" && "h-6 w-6"
            )}
            aria-label="Clear search"
          >
            <X className="h-full w-full" />
          </button>
        )}
      </div>
    );
  }
);
SearchInput.displayName = "SearchInput";

export { SearchInput };
