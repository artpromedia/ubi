/**
 * Empty State Component
 *
 * Placeholder for empty lists, search results, or errors.
 */

import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertCircle,
  FileQuestion,
  FolderOpen,
  Inbox,
  Search,
} from "lucide-react";

import { Button } from "./button";
import { cn } from "../lib/utils";

import type * as React from "react";

const emptyStateVariants = cva(
  "flex flex-col items-center justify-center text-center",
  {
    variants: {
      size: {
        sm: "py-8",
        default: "py-12",
        lg: "py-16",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

const iconVariants = cva("rounded-full flex items-center justify-center mb-4", {
  variants: {
    variant: {
      default: "bg-muted text-muted-foreground",
      primary: "bg-primary/10 text-primary",
      success: "bg-success/10 text-success",
      warning: "bg-warning/10 text-warning",
      destructive: "bg-destructive/10 text-destructive",
    },
    size: {
      sm: "h-12 w-12",
      default: "h-16 w-16",
      lg: "h-20 w-20",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

interface EmptyStateProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof emptyStateVariants> {
  icon?: React.ReactNode;
  iconVariant?: "default" | "primary" | "success" | "warning" | "destructive";
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: "default" | "outline" | "ghost";
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

const EmptyState = ({
  icon,
  iconVariant = "default",
  title,
  description,
  action,
  secondaryAction,
  size,
  className,
  ...props
}: EmptyStateProps) => {
  return (
    <div className={cn(emptyStateVariants({ size }), className)} {...props}>
      {icon && (
        <div className={cn(iconVariants({ variant: iconVariant, size }))}>
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold font-heading mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-2">
          {action && (
            <Button
              variant={action.variant || "default"}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="ghost" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

// Preset empty states for common use cases
interface PresetEmptyStateProps extends Omit<
  EmptyStateProps,
  "icon" | "title"
> {
  title?: string;
}

const NoResults = ({
  title = "No results found",
  description = "Try adjusting your search or filters to find what you're looking for.",
  ...props
}: PresetEmptyStateProps) => (
  <EmptyState
    icon={<Search className="h-6 w-6" />}
    title={title}
    description={description}
    {...props}
  />
);

const NoData = ({
  title = "No data yet",
  description = "Get started by creating your first item.",
  ...props
}: PresetEmptyStateProps) => (
  <EmptyState
    icon={<Inbox className="h-6 w-6" />}
    title={title}
    description={description}
    {...props}
  />
);

const NotFound = ({
  title = "Page not found",
  description = "The page you're looking for doesn't exist or has been moved.",
  ...props
}: PresetEmptyStateProps) => (
  <EmptyState
    icon={<FileQuestion className="h-6 w-6" />}
    title={title}
    description={description}
    {...props}
  />
);

const ErrorState = ({
  title = "Something went wrong",
  description = "An error occurred while loading. Please try again.",
  ...props
}: PresetEmptyStateProps) => (
  <EmptyState
    icon={<AlertCircle className="h-6 w-6" />}
    iconVariant="destructive"
    title={title}
    description={description}
    {...props}
  />
);

const EmptyFolder = ({
  title = "This folder is empty",
  description = "Add files or folders to get started.",
  ...props
}: PresetEmptyStateProps) => (
  <EmptyState
    icon={<FolderOpen className="h-6 w-6" />}
    title={title}
    description={description}
    {...props}
  />
);

export {
  EmptyFolder,
  EmptyState,
  emptyStateVariants,
  ErrorState,
  iconVariants,
  NoData,
  NoResults,
  NotFound,
};
