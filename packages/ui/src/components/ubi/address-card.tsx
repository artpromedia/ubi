/**
 * Address Card
 *
 * Mobile-optimized saved address card with edit/delete actions
 * and type indicators (home, work, etc.)
 */

import { cva, type VariantProps } from "class-variance-authority";
import {
  Briefcase,
  Edit2,
  Home,
  MapPin,
  MoreVertical,
  Navigation,
  Star,
  Trash2,
} from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";

const addressCardVariants = cva(
  "relative rounded-xl border bg-white dark:bg-gray-900 p-4 transition-all",
  {
    variants: {
      variant: {
        default: "border-gray-200 dark:border-gray-800",
        selected: "border-green-500 bg-green-50 dark:bg-green-900/20",
        selectable:
          "border-gray-200 dark:border-gray-800 hover:border-green-300 dark:hover:border-green-700 cursor-pointer active:scale-[0.98]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type AddressType = "home" | "work" | "favorite" | "other";

export interface AddressCardProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof addressCardVariants> {
  /** Address type */
  type: AddressType;
  /** Address label (e.g., "Home", "Work", "Grandma's House") */
  label: string;
  /** Full address string */
  address: string;
  /** Optional distance from current location */
  distance?: string;
  /** Whether this is the default address for this type */
  isDefault?: boolean;
  /** Whether card is selected */
  selected?: boolean;
  /** Whether to show action menu */
  showActions?: boolean;
  /** Callback when card is selected */
  onSelect?: () => void;
  /** Callback when edit is pressed */
  onEdit?: () => void;
  /** Callback when delete is pressed */
  onDelete?: () => void;
  /** Callback when navigate is pressed */
  onNavigate?: () => void;
}

const typeConfig = {
  home: {
    icon: Home,
    color: "text-blue-500",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  work: {
    icon: Briefcase,
    color: "text-purple-500",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
  },
  favorite: {
    icon: Star,
    color: "text-yellow-500",
    bgColor: "bg-yellow-100 dark:bg-yellow-900/30",
  },
  other: {
    icon: MapPin,
    color: "text-gray-500",
    bgColor: "bg-gray-100 dark:bg-gray-800",
  },
};

export const AddressCard = ({
  className,
  variant,
  type,
  label,
  address,
  distance,
  isDefault,
  selected,
  showActions = true,
  onSelect,
  onEdit,
  onDelete,
  onNavigate,
  ...props
}: AddressCardProps) => {
  const [showMenu, setShowMenu] = React.useState(false);
  const config = typeConfig[type];
  const IconComponent = config.icon;

  const handleClick = () => {
    if (variant === "selectable" && onSelect) {
      onSelect();
    }
  };

  return (
    <div
      className={cn(
        addressCardVariants({ variant: selected ? "selected" : variant }),
        className,
      )}
      onClick={handleClick}
      {...props}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={cn(
            "h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0",
            config.bgColor,
          )}
        >
          <IconComponent className={cn("h-5 w-5", config.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-gray-900 dark:text-white truncate">
              {label}
            </h4>
            {isDefault && (
              <span className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                Default
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
            {address}
          </p>
          {distance && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {distance} away
            </p>
          )}
        </div>

        {/* Actions */}
        {showActions && (
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="p-2 -mr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="More options"
            >
              <MoreVertical className="h-4 w-4" />
            </button>

            {/* Dropdown Menu */}
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                  }}
                />
                <div className="absolute right-0 top-full mt-1 z-20 w-40 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  {onNavigate && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onNavigate();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Navigation className="h-4 w-4" />
                      Navigate
                    </button>
                  )}
                  {onEdit && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onEdit();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Edit2 className="h-4 w-4" />
                      Edit
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onDelete();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Selection indicator */}
        {variant === "selectable" && (
          <div
            className={cn(
              "h-6 w-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
              selected
                ? "border-green-500 bg-green-500"
                : "border-gray-300 dark:border-gray-600",
            )}
          >
            {selected && (
              <svg
                className="h-3 w-3 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export { addressCardVariants };
