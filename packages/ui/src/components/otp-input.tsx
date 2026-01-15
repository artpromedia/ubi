"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * OTPInput - One-Time Password input for verification codes
 *
 * @example
 * <OTPInput
 *   length={6}
 *   value={otp}
 *   onChange={setOtp}
 *   onComplete={(code) => verify(code)}
 * />
 */

export interface OTPInputProps {
  /** Number of digits */
  length?: number;
  /** Current value */
  value?: string;
  /** Change handler */
  onChange?: (value: string) => void;
  /** Called when all digits are filled */
  onComplete?: (value: string) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Error state */
  error?: boolean;
  /** Auto-focus first input on mount */
  autoFocus?: boolean;
  /** Input type - use "password" for hidden digits */
  type?: "text" | "password";
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional class name */
  className?: string;
}

const OTPInput = React.forwardRef<HTMLDivElement, OTPInputProps>(
  (
    {
      length = 6,
      value = "",
      onChange,
      onComplete,
      disabled,
      error,
      autoFocus = true,
      type = "text",
      size = "md",
      className,
    },
    ref,
  ) => {
    const inputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
    const [activeIndex, setActiveIndex] = React.useState(-1);

    // Initialize refs array
    React.useEffect(() => {
      inputRefs.current = inputRefs.current.slice(0, length);
    }, [length]);

    // Auto-focus first input
    React.useEffect(() => {
      if (autoFocus && inputRefs.current[0]) {
        inputRefs.current[0].focus();
      }
    }, [autoFocus]);

    // Check for completion
    React.useEffect(() => {
      if (value.length === length && onComplete) {
        onComplete(value);
      }
    }, [value, length, onComplete]);

    const handleChange = (index: number, digit: string) => {
      // Only allow single digits
      const sanitized = digit.replace(/\D/g, "").slice(0, 1);

      const newValue = value.split("");
      newValue[index] = sanitized;
      const result = newValue.join("").slice(0, length);

      onChange?.(result);

      // Move to next input if digit entered
      if (sanitized && index < length - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    };

    const handleKeyDown = (
      index: number,
      e: React.KeyboardEvent<HTMLInputElement>,
    ) => {
      if (e.key === "Backspace") {
        e.preventDefault();

        if (value[index]) {
          // Clear current digit
          const newValue = value.split("");
          newValue[index] = "";
          onChange?.(newValue.join(""));
        } else if (index > 0) {
          // Move to previous input and clear it
          inputRefs.current[index - 1]?.focus();
          const newValue = value.split("");
          newValue[index - 1] = "";
          onChange?.(newValue.join(""));
        }
      } else if (e.key === "ArrowLeft" && index > 0) {
        inputRefs.current[index - 1]?.focus();
      } else if (e.key === "ArrowRight" && index < length - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pastedData = e.clipboardData
        .getData("text")
        .replace(/\D/g, "")
        .slice(0, length);
      onChange?.(pastedData);

      // Focus appropriate input after paste
      const focusIndex = Math.min(pastedData.length, length - 1);
      inputRefs.current[focusIndex]?.focus();
    };

    const sizeClasses = {
      sm: "h-10 w-8 text-lg",
      md: "h-12 w-10 text-xl",
      lg: "h-14 w-12 text-2xl",
    };

    const gapClasses = {
      sm: "gap-2",
      md: "gap-3",
      lg: "gap-4",
    };

    return (
      <div
        ref={ref}
        className={cn("flex items-center", gapClasses[size], className)}
        role="group"
        aria-label="OTP input"
      >
        {Array.from({ length }).map((_, index) => (
          <input
            key={index}
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            type={type}
            inputMode="numeric"
            maxLength={1}
            value={value[index] || ""}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            onFocus={() => setActiveIndex(index)}
            onBlur={() => setActiveIndex(-1)}
            disabled={disabled}
            aria-label={`Digit ${index + 1}`}
            className={cn(
              "text-center font-mono rounded-lg border bg-background transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              sizeClasses[size],
              error
                ? "border-destructive focus-visible:ring-destructive"
                : "border-input",
              activeIndex === index &&
                !error &&
                "border-primary ring-2 ring-primary/20",
            )}
          />
        ))}
      </div>
    );
  },
);
OTPInput.displayName = "OTPInput";

export { OTPInput };
