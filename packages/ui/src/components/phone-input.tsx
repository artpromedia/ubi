"use client";

import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

/**
 * PhoneInput - Phone number input with country code selector
 *
 * Pre-configured for African countries with popular country codes.
 *
 * @example
 * <PhoneInput
 *   value={phone}
 *   onChange={setPhone}
 *   defaultCountry="NG"
 * />
 */

interface Country {
  code: string;
  name: string;
  dialCode: string;
  flag: string;
}

// African countries most relevant for UBI
const COUNTRIES: Country[] = [
  { code: "NG", name: "Nigeria", dialCode: "+234", flag: "🇳🇬" },
  { code: "GH", name: "Ghana", dialCode: "+233", flag: "🇬🇭" },
  { code: "KE", name: "Kenya", dialCode: "+254", flag: "🇰🇪" },
  { code: "ZA", name: "South Africa", dialCode: "+27", flag: "🇿🇦" },
  { code: "EG", name: "Egypt", dialCode: "+20", flag: "🇪🇬" },
  { code: "TZ", name: "Tanzania", dialCode: "+255", flag: "🇹🇿" },
  { code: "UG", name: "Uganda", dialCode: "+256", flag: "🇺🇬" },
  { code: "RW", name: "Rwanda", dialCode: "+250", flag: "🇷🇼" },
  { code: "ET", name: "Ethiopia", dialCode: "+251", flag: "🇪🇹" },
  { code: "CI", name: "Côte d'Ivoire", dialCode: "+225", flag: "🇨🇮" },
  { code: "SN", name: "Senegal", dialCode: "+221", flag: "🇸🇳" },
  { code: "CM", name: "Cameroon", dialCode: "+237", flag: "🇨🇲" },
  { code: "MA", name: "Morocco", dialCode: "+212", flag: "🇲🇦" },
  { code: "AO", name: "Angola", dialCode: "+244", flag: "🇦🇴" },
  { code: "MZ", name: "Mozambique", dialCode: "+258", flag: "🇲🇿" },
];

export interface PhoneInputValue {
  countryCode: string;
  dialCode: string;
  number: string;
  fullNumber: string;
}

export interface PhoneInputProps {
  /** Current value */
  value?: PhoneInputValue;
  /** Change handler */
  onChange?: (value: PhoneInputValue) => void;
  /** Default country code (ISO 3166-1 alpha-2) */
  defaultCountry?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Error state */
  error?: boolean;
  /** Additional class name */
  className?: string;
  /** ID for the input */
  id?: string;
  /** Name attribute */
  name?: string;
}

const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  (
    {
      value,
      onChange,
      defaultCountry = "NG",
      placeholder = "Enter phone number",
      disabled,
      error,
      className,
      id,
      name,
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [selectedCountry, setSelectedCountry] = React.useState<Country>(
      () => COUNTRIES.find((c) => c.code === defaultCountry) ?? COUNTRIES[0]!
    );
    const [phoneNumber, setPhoneNumber] = React.useState(value?.number || "");
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    // Update internal state when value prop changes
    React.useEffect(() => {
      if (value) {
        const country = COUNTRIES.find((c) => c.code === value.countryCode);
        if (country) {
          setSelectedCountry(country);
        }
        setPhoneNumber(value.number);
      }
    }, [value]);

    // Close dropdown on outside click
    React.useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          dropdownRef.current &&
          !dropdownRef.current.contains(event.target as Node)
        ) {
          setIsOpen(false);
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleCountrySelect = (country: Country) => {
      setSelectedCountry(country);
      setIsOpen(false);

      onChange?.({
        countryCode: country.code,
        dialCode: country.dialCode,
        number: phoneNumber,
        fullNumber: `${country.dialCode}${phoneNumber}`,
      });
    };

    const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Only allow digits
      const number = e.target.value.replace(/\D/g, "");
      setPhoneNumber(number);

      onChange?.({
        countryCode: selectedCountry.code,
        dialCode: selectedCountry.dialCode,
        number,
        fullNumber: `${selectedCountry.dialCode}${number}`,
      });
    };

    return (
      <div className={cn("relative", className)} ref={dropdownRef}>
        <div
          className={cn(
            "flex h-10 w-full rounded-lg border bg-background ring-offset-background",
            error ? "border-destructive" : "border-input",
            "focus-within:ring-2 focus-within:ring-offset-2",
            error ? "focus-within:ring-destructive" : "focus-within:ring-ring",
            disabled && "cursor-not-allowed opacity-50"
          )}
        >
          {/* Country selector */}
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            disabled={disabled}
            className={cn(
              "flex items-center gap-1 px-3 border-r border-input hover:bg-accent/50 transition-colors rounded-l-lg",
              disabled && "cursor-not-allowed"
            )}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
          >
            <span className="text-lg">{selectedCountry.flag}</span>
            <span className="text-sm text-muted-foreground">
              {selectedCountry.dialCode}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                isOpen && "rotate-180"
              )}
            />
          </button>

          {/* Phone number input */}
          <input
            ref={ref}
            type="tel"
            id={id}
            name={name}
            value={phoneNumber}
            onChange={handleNumberChange}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              "flex-1 bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground",
              "focus-visible:outline-none",
              disabled && "cursor-not-allowed"
            )}
          />
        </div>

        {/* Country dropdown */}
        {isOpen && (
          <div
            className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
            role="listbox"
          >
            {COUNTRIES.map((country) => (
              <button
                key={country.code}
                type="button"
                onClick={() => handleCountrySelect(country)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  country.code === selectedCountry.code && "bg-accent"
                )}
                role="option"
                aria-selected={country.code === selectedCountry.code}
              >
                <span className="text-lg">{country.flag}</span>
                <span className="flex-1 text-left">{country.name}</span>
                <span className="text-muted-foreground">
                  {country.dialCode}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
);
PhoneInput.displayName = "PhoneInput";

export { COUNTRIES, PhoneInput };
