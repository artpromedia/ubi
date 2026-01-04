"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Bike, Car, Clock, MapPin, Star } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * RestaurantCard - Display restaurant information
 *
 * Used in restaurant listings, search results, and favorites.
 *
 * @example
 * <RestaurantCard
 *   name="Mama's Kitchen"
 *   image="/images/restaurant.jpg"
 *   rating={4.5}
 *   reviewCount={234}
 *   deliveryTime="25-35 min"
 *   deliveryFee="₦500"
 *   cuisine={["Nigerian", "African"]}
 *   promoted
 * />
 */

const restaurantCardVariants = cva(
  "group rounded-xl overflow-hidden bg-card border transition-all",
  {
    variants: {
      size: {
        sm: "w-[180px]",
        md: "w-[280px]",
        lg: "w-full",
        full: "w-full",
      },
      interactive: {
        true: "cursor-pointer hover:shadow-lg hover:border-ubi-bites/50",
        false: "",
      },
    },
    defaultVariants: {
      size: "md",
      interactive: true,
    },
  }
);

export interface RestaurantCardProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "onClick">,
    VariantProps<typeof restaurantCardVariants> {
  /** Restaurant name */
  name: string;
  /** Cover image URL */
  image?: string;
  /** Rating value (0-5) */
  rating?: number;
  /** Number of reviews */
  reviewCount?: number;
  /** Estimated delivery time */
  deliveryTime?: string;
  /** Delivery fee */
  deliveryFee?: string;
  /** Free delivery */
  freeDelivery?: boolean;
  /** Cuisine types */
  cuisine?: string[];
  /** Distance */
  distance?: string;
  /** Is restaurant currently open */
  isOpen?: boolean;
  /** Featured/promoted restaurant */
  promoted?: boolean;
  /** Delivery types supported */
  deliveryTypes?: ("bike" | "car")[];
  /** Minimum order */
  minimumOrder?: string;
  /** Click handler */
  onClick?: () => void;
}

const RestaurantCard = React.forwardRef<HTMLDivElement, RestaurantCardProps>(
  (
    {
      className,
      size,
      interactive,
      name,
      image,
      rating,
      reviewCount,
      deliveryTime,
      deliveryFee,
      freeDelivery,
      cuisine,
      distance,
      isOpen = true,
      promoted,
      deliveryTypes,
      minimumOrder,
      onClick,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          restaurantCardVariants({
            size,
            interactive: interactive || !!onClick,
          }),
          !isOpen && "opacity-75",
          className
        )}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        {...props}
      >
        {/* Image section */}
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          {image ? (
            <img
              src={image}
              alt={name}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-ubi-bites/20 to-ubi-bites/5" />
          )}

          {/* Badges */}
          <div className="absolute top-2 left-2 flex flex-col gap-1">
            {promoted && (
              <span className="px-2 py-0.5 rounded-full bg-ubi-bites text-white text-xs font-medium">
                Promoted
              </span>
            )}
            {freeDelivery && (
              <span className="px-2 py-0.5 rounded-full bg-green-500 text-white text-xs font-medium">
                Free Delivery
              </span>
            )}
          </div>

          {/* Closed overlay */}
          {!isOpen && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
              <span className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-sm font-medium">
                Currently Closed
              </span>
            </div>
          )}
        </div>

        {/* Content section */}
        <div className={cn("p-3", size === "sm" && "p-2")}>
          {/* Name and rating */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3
              className={cn(
                "font-semibold truncate",
                size === "sm" ? "text-sm" : "text-base"
              )}
            >
              {name}
            </h3>
            {rating !== undefined && (
              <div className="flex items-center gap-0.5 shrink-0">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                <span className="text-sm font-medium">{rating.toFixed(1)}</span>
                {reviewCount !== undefined && size !== "sm" && (
                  <span className="text-xs text-muted-foreground">
                    (
                    {reviewCount > 999
                      ? `${(reviewCount / 1000).toFixed(1)}k`
                      : reviewCount}
                    )
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Cuisine */}
          {cuisine && cuisine.length > 0 && (
            <p className="text-xs text-muted-foreground truncate mb-2">
              {cuisine.join(" • ")}
            </p>
          )}

          {/* Delivery info */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {deliveryTime && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {deliveryTime}
              </div>
            )}
            {distance && (
              <div className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {distance}
              </div>
            )}
            {deliveryFee && !freeDelivery && <span>{deliveryFee}</span>}
            {deliveryTypes && deliveryTypes.length > 0 && size !== "sm" && (
              <div className="flex items-center gap-1 ml-auto">
                {deliveryTypes.includes("bike") && <Bike className="h-3 w-3" />}
                {deliveryTypes.includes("car") && <Car className="h-3 w-3" />}
              </div>
            )}
          </div>

          {/* Minimum order */}
          {minimumOrder && size === "lg" && (
            <p className="text-xs text-muted-foreground mt-2">
              Min. order: {minimumOrder}
            </p>
          )}
        </div>
      </div>
    );
  }
);
RestaurantCard.displayName = "RestaurantCard";

export { RestaurantCard, restaurantCardVariants };
