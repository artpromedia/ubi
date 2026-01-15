"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";

/**
 * MenuItem - Display a menu item for ordering
 *
 * @example
 * <MenuItem
 *   name="Jollof Rice"
 *   description="Spicy rice with tomato sauce"
 *   price="₦2,500"
 *   image="/images/jollof.jpg"
 *   onAdd={() => addToCart(item)}
 * />
 */

export interface MenuItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Item name */
  name: string;
  /** Description */
  description?: string;
  /** Price display */
  price: string;
  /** Original price (for discounts) */
  originalPrice?: string;
  /** Image URL */
  image?: string;
  /** Is item available */
  available?: boolean;
  /** Dietary tags */
  tags?: string[];
  /** Spice level (1-5) */
  spiceLevel?: number;
  /** Quantity in cart */
  quantity?: number;
  /** Add handler */
  onAdd?: () => void;
  /** Remove handler */
  onRemove?: () => void;
  /** Update quantity handler */
  onQuantityChange?: (quantity: number) => void;
  /** Layout variant */
  variant?: "compact" | "default" | "detailed";
}

const MenuItem = React.forwardRef<HTMLDivElement, MenuItemProps>(
  (
    {
      className,
      name,
      description,
      price,
      originalPrice,
      image,
      available = true,
      tags,
      spiceLevel,
      quantity = 0,
      onAdd,
      onRemove,
      onQuantityChange,
      variant = "default",
      ...props
    },
    ref,
  ) => {
    const handleIncrement = () => {
      if (quantity > 0) {
        onQuantityChange?.(quantity + 1);
      } else {
        onAdd?.();
      }
    };

    const handleDecrement = () => {
      if (quantity > 1) {
        onQuantityChange?.(quantity - 1);
      } else if (quantity === 1) {
        onRemove?.();
      }
    };

    return (
      <div
        ref={ref}
        className={cn(
          "flex gap-4 p-4 rounded-lg border bg-card transition-colors",
          !available && "opacity-60",
          available && "hover:bg-accent/30",
          variant === "compact" && "p-3 gap-3",
          className,
        )}
        {...props}
      >
        {/* Image */}
        {image && variant !== "compact" && (
          <div
            className={cn(
              "relative shrink-0 rounded-lg overflow-hidden bg-muted",
              variant === "detailed" ? "w-28 h-28" : "w-20 h-20",
            )}
          >
            <img
              src={image}
              alt={name}
              className="w-full h-full object-cover"
            />
            {!available && (
              <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                <span className="text-xs font-medium text-muted-foreground">
                  Unavailable
                </span>
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3
                className={cn(
                  "font-medium",
                  variant === "compact" ? "text-sm" : "text-base",
                )}
              >
                {name}
              </h3>
              {/* Tags */}
              {tags && tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Price */}
            <div className="text-right shrink-0">
              <span className="font-semibold text-ubi-bites">{price}</span>
              {originalPrice && (
                <span className="block text-xs text-muted-foreground line-through">
                  {originalPrice}
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          {description && variant !== "compact" && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {description}
            </p>
          )}

          {/* Spice level */}
          {spiceLevel !== undefined && spiceLevel > 0 && (
            <div className="flex items-center gap-1 mt-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "text-xs",
                    i < spiceLevel ? "text-red-500" : "text-gray-300",
                  )}
                >
                  🌶️
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          {available && (onAdd || onQuantityChange) && (
            <div className="flex items-center justify-end mt-3">
              {quantity > 0 ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDecrement}
                    className="h-8 w-8 rounded-full border border-input flex items-center justify-center hover:bg-accent transition-colors"
                    aria-label="Decrease quantity"
                  >
                    {quantity === 1 ? (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    ) : (
                      <Minus className="h-4 w-4" />
                    )}
                  </button>
                  <span className="w-8 text-center font-medium">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={handleIncrement}
                    className="h-8 w-8 rounded-full bg-ubi-bites text-white flex items-center justify-center hover:bg-ubi-bites/90 transition-colors"
                    aria-label="Increase quantity"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onAdd}
                  className="px-4 py-1.5 rounded-full bg-ubi-bites/10 text-ubi-bites text-sm font-medium hover:bg-ubi-bites/20 transition-colors"
                >
                  Add
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);
MenuItem.displayName = "MenuItem";

export { MenuItem };
