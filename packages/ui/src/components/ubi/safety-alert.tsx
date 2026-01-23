/**
 * Safety Alert
 *
 * Mobile-optimized emergency/safety alert component with
 * quick action buttons for SOS and emergency contacts.
 */

import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertTriangle,
  Bell,
  MapPin,
  Phone,
  Shield,
  Users,
  X,
} from "lucide-react";

import { cn } from "../../lib/utils";

import type * as React from "react";

const safetyAlertVariants = cva("relative rounded-2xl overflow-hidden", {
  variants: {
    severity: {
      info: "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800",
      warning:
        "bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800",
      danger:
        "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800",
      emergency: "bg-red-600 text-white",
    },
  },
  defaultVariants: {
    severity: "info",
  },
});

export interface SafetyAlertProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof safetyAlertVariants> {
  /** Alert title */
  title: string;
  /** Alert message */
  message?: string;
  /** Whether the alert is dismissible */
  dismissible?: boolean;
  /** Callback when dismissed */
  onDismiss?: () => void;
  /** Whether to show emergency actions */
  showEmergencyActions?: boolean;
  /** Callback when SOS is triggered */
  onSOS?: () => void;
  /** Callback when share location is pressed */
  onShareLocation?: () => void;
  /** Callback when call emergency is pressed */
  onCallEmergency?: () => void;
  /** Callback when contact trusted person is pressed */
  onContactTrusted?: () => void;
  /** Custom actions */
  actions?: React.ReactNode;
}

const severityConfig = {
  info: {
    icon: Bell,
    iconColor: "text-blue-500",
    textColor: "text-blue-900 dark:text-blue-100",
    subtextColor: "text-blue-700 dark:text-blue-300",
  },
  warning: {
    icon: AlertTriangle,
    iconColor: "text-yellow-600",
    textColor: "text-yellow-900 dark:text-yellow-100",
    subtextColor: "text-yellow-700 dark:text-yellow-300",
  },
  danger: {
    icon: AlertTriangle,
    iconColor: "text-red-500",
    textColor: "text-red-900 dark:text-red-100",
    subtextColor: "text-red-700 dark:text-red-300",
  },
  emergency: {
    icon: Shield,
    iconColor: "text-white",
    textColor: "text-white",
    subtextColor: "text-white/80",
  },
};

export const SafetyAlert = ({
  className,
  severity = "info",
  title,
  message,
  dismissible = false,
  onDismiss,
  showEmergencyActions = false,
  onSOS,
  onShareLocation,
  onCallEmergency,
  onContactTrusted,
  actions,
  ...props
}: SafetyAlertProps) => {
  const config = severityConfig[severity];
  const IconComponent = config.icon;
  const isEmergency = severity === "emergency";

  return (
    <div
      className={cn(safetyAlertVariants({ severity }), className)}
      role="alert"
      {...props}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className={cn(
              "h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0",
              isEmergency ? "bg-white/20" : "bg-white dark:bg-gray-800",
            )}
          >
            <IconComponent className={cn("h-5 w-5", config.iconColor)} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h4 className={cn("font-semibold", config.textColor)}>{title}</h4>
            {message && (
              <p className={cn("text-sm mt-1", config.subtextColor)}>
                {message}
              </p>
            )}
          </div>

          {/* Dismiss */}
          {dismissible && (
            <button
              onClick={onDismiss}
              className={cn(
                "p-1 rounded-full transition-colors",
                isEmergency
                  ? "text-white/70 hover:text-white hover:bg-white/10"
                  : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
              )}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Emergency Actions */}
        {showEmergencyActions && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {onSOS && (
              <button
                onClick={onSOS}
                className={cn(
                  "flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold transition-colors",
                  isEmergency
                    ? "bg-white text-red-600 hover:bg-white/90"
                    : "bg-red-600 text-white hover:bg-red-700",
                )}
              >
                <Shield className="h-5 w-5" />
                SOS
              </button>
            )}
            {onShareLocation && (
              <button
                onClick={onShareLocation}
                className={cn(
                  "flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-colors",
                  isEmergency
                    ? "bg-white/20 text-white hover:bg-white/30"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700",
                )}
              >
                <MapPin className="h-4 w-4" />
                Share Location
              </button>
            )}
            {onCallEmergency && (
              <button
                onClick={onCallEmergency}
                className={cn(
                  "flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-colors",
                  isEmergency
                    ? "bg-white/20 text-white hover:bg-white/30"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700",
                )}
              >
                <Phone className="h-4 w-4" />
                Emergency
              </button>
            )}
            {onContactTrusted && (
              <button
                onClick={onContactTrusted}
                className={cn(
                  "flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-colors",
                  isEmergency
                    ? "bg-white/20 text-white hover:bg-white/30"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700",
                )}
              >
                <Users className="h-4 w-4" />
                Contact
              </button>
            )}
          </div>
        )}

        {/* Custom Actions */}
        {actions && <div className="mt-4">{actions}</div>}
      </div>

      {/* Pulsing border for emergency */}
      {isEmergency && (
        <div className="absolute inset-0 rounded-2xl border-2 border-white/50 animate-pulse pointer-events-none" />
      )}
    </div>
  );
};

/**
 * SOS Button
 *
 * Prominent SOS button for emergency situations.
 */
export interface SOSButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether button is in activated state */
  activated?: boolean;
  /** Size of the button */
  size?: "sm" | "md" | "lg";
  /** Label text */
  label?: string;
}

export const SOSButton = ({
  className,
  activated = false,
  size = "md",
  label = "SOS",
  ...props
}: SOSButtonProps) => {
  const sizeClasses = {
    sm: "h-12 w-12 text-sm",
    md: "h-16 w-16 text-base",
    lg: "h-20 w-20 text-lg",
  };

  return (
    <button
      className={cn(
        "relative rounded-full font-bold transition-all",
        "bg-red-600 text-white shadow-lg",
        "hover:bg-red-700 active:scale-95",
        activated && "animate-pulse bg-red-500",
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      <Shield
        className={cn(
          "mx-auto",
          size === "sm" ? "h-5 w-5" : size === "lg" ? "h-8 w-8" : "h-6 w-6",
        )}
      />
      <span className="sr-only">{label}</span>

      {/* Ripple effect */}
      {activated && (
        <>
          <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-75" />
          <span className="absolute inset-0 rounded-full border-4 border-red-300 animate-pulse" />
        </>
      )}
    </button>
  );
};

export { safetyAlertVariants };
