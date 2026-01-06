"use client";

import { cva, type VariantProps } from "class-variance-authority";
import {
  Bike,
  Car,
  Clock,
  MapPin,
  Package,
  Users,
  Utensils,
  Zap,
} from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * ServiceSelector - Select between UBI services
 *
 * Used on the home screen to choose between Move, Bites, Send, etc.
 *
 * @example
 * <ServiceSelector
 *   selected="move"
 *   onSelect={setService}
 *   services={["move", "bites", "send"]}
 * />
 */

const serviceConfigs = {
  move: {
    label: "Move",
    description: "Ride anywhere",
    icon: Car,
    color: "bg-ubi-move text-white",
    hoverColor: "hover:bg-ubi-move/90",
    borderColor: "border-ubi-move",
    lightBg: "bg-ubi-move/10",
    textColor: "text-ubi-move",
  },
  bites: {
    label: "Bites",
    description: "Food delivery",
    icon: Utensils,
    color: "bg-ubi-bites text-white",
    hoverColor: "hover:bg-ubi-bites/90",
    borderColor: "border-ubi-bites",
    lightBg: "bg-ubi-bites/10",
    textColor: "text-ubi-bites",
  },
  send: {
    label: "Send",
    description: "Package delivery",
    icon: Package,
    color: "bg-ubi-send text-white",
    hoverColor: "hover:bg-ubi-send/90",
    borderColor: "border-ubi-send",
    lightBg: "bg-ubi-send/10",
    textColor: "text-ubi-send",
  },
  ev: {
    label: "EV",
    description: "Electric rides",
    icon: Zap,
    color: "bg-[#00793A] text-white",
    hoverColor: "hover:bg-[#00793A]/90",
    borderColor: "border-[#00793A]",
    lightBg: "bg-[#00793A]/10",
    textColor: "text-[#00793A]",
  },
  bike: {
    label: "Bike",
    description: "Motorcycle rides",
    icon: Bike,
    color: "bg-purple-600 text-white",
    hoverColor: "hover:bg-purple-600/90",
    borderColor: "border-purple-600",
    lightBg: "bg-purple-600/10",
    textColor: "text-purple-600",
  },
  schedule: {
    label: "Schedule",
    description: "Book ahead",
    icon: Clock,
    color: "bg-indigo-600 text-white",
    hoverColor: "hover:bg-indigo-600/90",
    borderColor: "border-indigo-600",
    lightBg: "bg-indigo-600/10",
    textColor: "text-indigo-600",
  },
  carpool: {
    label: "Carpool",
    description: "Share rides",
    icon: Users,
    color: "bg-teal-600 text-white",
    hoverColor: "hover:bg-teal-600/90",
    borderColor: "border-teal-600",
    lightBg: "bg-teal-600/10",
    textColor: "text-teal-600",
  },
  city: {
    label: "City",
    description: "Explore places",
    icon: MapPin,
    color: "bg-rose-600 text-white",
    hoverColor: "hover:bg-rose-600/90",
    borderColor: "border-rose-600",
    lightBg: "bg-rose-600/10",
    textColor: "text-rose-600",
  },
};

type ServiceType = keyof typeof serviceConfigs;

const serviceSelectorVariants = cva("flex gap-2", {
  variants: {
    layout: {
      horizontal: "flex-row flex-wrap",
      vertical: "flex-col",
      grid: "grid grid-cols-4 sm:grid-cols-4",
    },
  },
  defaultVariants: {
    layout: "horizontal",
  },
});

export interface ServiceSelectorProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect">,
    VariantProps<typeof serviceSelectorVariants> {
  /** Currently selected service */
  selected?: ServiceType;
  /** Selection handler */
  onSelect?: (service: ServiceType) => void;
  /** Available services */
  services?: ServiceType[];
  /** Display variant */
  variant?: "pill" | "card" | "icon";
}

const ServiceSelector = React.forwardRef<HTMLDivElement, ServiceSelectorProps>(
  (
    {
      className,
      layout,
      selected,
      onSelect,
      services = ["move", "bites", "send"],
      variant = "pill",
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(serviceSelectorVariants({ layout }), className)}
        role="radiogroup"
        aria-label="Select service"
        {...props}
      >
        {services.map((service) => {
          const config = serviceConfigs[service];
          const isSelected = selected === service;
          const Icon = config.icon;

          if (variant === "icon") {
            return (
              <button
                key={service}
                type="button"
                onClick={() => onSelect?.(service)}
                role="radio"
                aria-checked={isSelected}
                className={cn(
                  "flex flex-col items-center gap-1 p-2 rounded-lg transition-colors",
                  isSelected ? config.lightBg : "hover:bg-accent"
                )}
              >
                <div
                  className={cn(
                    "p-2 rounded-full transition-colors",
                    isSelected ? config.color : "bg-muted"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <span
                  className={cn(
                    "text-xs font-medium",
                    isSelected ? config.textColor : "text-muted-foreground"
                  )}
                >
                  {config.label}
                </span>
              </button>
            );
          }

          if (variant === "card") {
            return (
              <button
                key={service}
                type="button"
                onClick={() => onSelect?.(service)}
                role="radio"
                aria-checked={isSelected}
                className={cn(
                  "flex flex-col items-start p-4 rounded-xl border-2 transition-all min-w-[140px]",
                  isSelected
                    ? cn(config.borderColor, config.lightBg)
                    : "border-transparent bg-card hover:border-border"
                )}
              >
                <div
                  className={cn(
                    "p-2 rounded-lg mb-2",
                    isSelected ? config.color : "bg-muted"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <span className="font-semibold">{config.label}</span>
                <span className="text-xs text-muted-foreground">
                  {config.description}
                </span>
              </button>
            );
          }

          // Default: pill variant
          return (
            <button
              key={service}
              type="button"
              onClick={() => onSelect?.(service)}
              role="radio"
              aria-checked={isSelected}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all",
                isSelected
                  ? cn(config.color, config.hoverColor)
                  : "bg-muted hover:bg-muted/80 text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {config.label}
            </button>
          );
        })}
      </div>
    );
  }
);
ServiceSelector.displayName = "ServiceSelector";

/**
 * ServiceBadge - Small badge showing service type
 */

export interface ServiceBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  service: ServiceType;
  showLabel?: boolean;
  size?: "sm" | "md";
}

const ServiceBadge = React.forwardRef<HTMLSpanElement, ServiceBadgeProps>(
  ({ className, service, showLabel = true, size = "md", ...props }, ref) => {
    const config = serviceConfigs[service];
    const Icon = config.icon;

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-medium",
          config.color,
          size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
          className
        )}
        {...props}
      >
        <Icon className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />
        {showLabel && config.label}
      </span>
    );
  }
);
ServiceBadge.displayName = "ServiceBadge";

export { ServiceBadge, serviceConfigs, ServiceSelector };
export type { ServiceType };
