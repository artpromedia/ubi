/**
 * Safety Center Component
 *
 * Comprehensive mobile safety hub with:
 * - Emergency contacts management
 * - Trip sharing controls
 * - SOS quick access
 * - Safety preferences
 * - Emergency numbers by country
 */

import {
  AlertTriangle,
  Bell,
  Heart,
  Info,
  Phone,
  Plus,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Star,
  Trash2,
  User,
  Users,
} from "lucide-react";

import { cn } from "../../lib/utils";

import type * as React from "react";

// =============================================================================
// TYPES
// =============================================================================

export interface EmergencyContact {
  id: string;
  name: string;
  phoneNumber: string;
  relationship?: string;
  isPrimary: boolean;
  notifyOnTrip: boolean;
  isVerified: boolean;
}

export interface SafetyPreferences {
  autoShareTrips: boolean;
  shareWithContacts: string[];
  nightModeEnabled: boolean;
  nightModeStart: string;
  nightModeEnd: string;
  womenSafetyMode: boolean;
  requirePinVerification: boolean;
  crashDetectionEnabled: boolean;
  safetyCheckInsEnabled: boolean;
}

export interface CountryEmergencyInfo {
  country: string;
  countryName: string;
  emergencyNumber: string;
  policeNumber: string;
  ambulanceNumber: string;
  fireNumber: string;
  ubiSafetyHotline?: string;
}

// =============================================================================
// SAFETY CENTER CONTAINER
// =============================================================================

export interface SafetyCenterProps extends React.HTMLAttributes<HTMLDivElement> {
  userCountry: string;
  countryInfo: CountryEmergencyInfo;
  emergencyContacts: EmergencyContact[];
  preferences: SafetyPreferences;
  hasActiveTrip?: boolean;
  tripShareActive?: boolean;
  onSOSPress?: () => void;
  onShareTrip?: () => void;
  onEndTripShare?: () => void;
  onAddContact?: () => void;
  onEditContact?: (contactId: string) => void;
  onDeleteContact?: (contactId: string) => void;
  onUpdatePreferences?: (prefs: Partial<SafetyPreferences>) => void;
  onCallEmergency?: (number: string) => void;
}

export const SafetyCenter = ({
  className,
  userCountry: _userCountry,
  countryInfo,
  emergencyContacts,
  preferences,
  hasActiveTrip = false,
  tripShareActive = false,
  onSOSPress,
  onShareTrip,
  onEndTripShare,
  onAddContact,
  onEditContact,
  onDeleteContact,
  onUpdatePreferences,
  onCallEmergency,
  ...props
}: SafetyCenterProps) => {
  return (
    <div className={cn("space-y-6 p-4", className)} {...props}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <Shield className="w-6 h-6 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Safety Center
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your safety is our priority
          </p>
        </div>
      </div>

      {/* SOS Section */}
      <SOSSection
        onSOSPress={onSOSPress}
        hasActiveTrip={hasActiveTrip}
        tripShareActive={tripShareActive}
        onShareTrip={onShareTrip}
        onEndTripShare={onEndTripShare}
      />

      {/* Emergency Contacts */}
      <EmergencyContactsSection
        contacts={emergencyContacts}
        onAddContact={onAddContact}
        onEditContact={onEditContact}
        onDeleteContact={onDeleteContact}
      />

      {/* Emergency Numbers */}
      <EmergencyNumbersSection
        countryInfo={countryInfo}
        onCallEmergency={onCallEmergency}
      />

      {/* Safety Preferences */}
      <SafetyPreferencesSection
        preferences={preferences}
        onUpdatePreferences={onUpdatePreferences}
      />

      {/* Safety Tips */}
      <SafetyTipsSection />
    </div>
  );
};

// =============================================================================
// SOS SECTION
// =============================================================================

interface SOSSectionProps {
  onSOSPress?: () => void;
  hasActiveTrip: boolean;
  tripShareActive: boolean;
  onShareTrip?: () => void;
  onEndTripShare?: () => void;
}

const SOSSection = ({
  onSOSPress,
  hasActiveTrip,
  tripShareActive,
  onShareTrip,
  onEndTripShare,
}: SOSSectionProps) => {
  return (
    <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-900/10 rounded-2xl p-5 border border-red-200 dark:border-red-800">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-red-900 dark:text-red-100">
            Emergency SOS
          </h2>
          <p className="text-sm text-red-700 dark:text-red-300">
            Press and hold for 3 seconds
          </p>
        </div>
        <button
          onClick={onSOSPress}
          className="w-20 h-20 rounded-full bg-red-600 hover:bg-red-700 active:scale-95 transition-all shadow-lg shadow-red-500/30 flex items-center justify-center"
          aria-label="Emergency SOS"
        >
          <span className="text-white font-bold text-xl">SOS</span>
        </button>
      </div>

      {/* Trip Sharing */}
      {hasActiveTrip && (
        <div className="mt-4 pt-4 border-t border-red-200 dark:border-red-800">
          {tripShareActive ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm text-red-800 dark:text-red-200">
                  Trip is being shared
                </span>
              </div>
              <button
                onClick={onEndTripShare}
                className="text-sm font-medium text-red-600 dark:text-red-400"
              >
                Stop Sharing
              </button>
            </div>
          ) : (
            <button
              onClick={onShareTrip}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors"
            >
              <Share2 className="w-5 h-5" />
              Share Trip with Contacts
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// EMERGENCY CONTACTS SECTION
// =============================================================================

interface EmergencyContactsSectionProps {
  contacts: EmergencyContact[];
  onAddContact?: () => void;
  onEditContact?: (contactId: string) => void;
  onDeleteContact?: (contactId: string) => void;
}

const EmergencyContactsSection = ({
  contacts,
  onAddContact,
  onEditContact,
  onDeleteContact,
}: EmergencyContactsSectionProps) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-gray-500" />
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Emergency Contacts
          </h2>
        </div>
        <button
          onClick={onAddContact}
          className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {contacts.length === 0 ? (
        <div className="p-6 text-center">
          <Users className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400 mb-3">
            No emergency contacts added
          </p>
          <button
            onClick={onAddContact}
            className="text-green-600 dark:text-green-400 font-medium"
          >
            Add your first contact
          </button>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <User className="w-5 h-5 text-gray-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {contact.name}
                    </span>
                    {contact.isPrimary && (
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                    )}
                    {contact.isVerified && (
                      <ShieldCheck className="w-4 h-4 text-green-500" />
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {contact.relationship && `${contact.relationship} • `}
                    {contact.phoneNumber}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onEditContact?.(contact.id)}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <Settings className="w-5 h-5" />
                </button>
                <button
                  onClick={() => onDeleteContact?.(contact.id)}
                  className="p-2 text-gray-400 hover:text-red-500"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// EMERGENCY NUMBERS SECTION
// =============================================================================

interface EmergencyNumbersSectionProps {
  countryInfo: CountryEmergencyInfo;
  onCallEmergency?: (number: string) => void;
}

const EmergencyNumbersSection = ({
  countryInfo,
  onCallEmergency,
}: EmergencyNumbersSectionProps) => {
  const numbers = [
    {
      label: "Police",
      number: countryInfo.policeNumber,
      icon: Shield,
      color: "blue",
    },
    {
      label: "Ambulance",
      number: countryInfo.ambulanceNumber,
      icon: Heart,
      color: "red",
    },
    {
      label: "Fire",
      number: countryInfo.fireNumber,
      icon: AlertTriangle,
      color: "orange",
    },
    ...(countryInfo.ubiSafetyHotline
      ? [
          {
            label: "UBI Safety",
            number: countryInfo.ubiSafetyHotline,
            icon: Shield,
            color: "green",
          },
        ]
      : []),
  ];

  const colorMap: Record<string, string> = {
    blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
    red: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
    orange:
      "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400",
    green:
      "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400",
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-3 mb-4">
        <Phone className="w-5 h-5 text-gray-500" />
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Emergency Numbers
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {countryInfo.countryName}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {numbers.map((item) => (
          <button
            key={item.label}
            onClick={() => onCallEmergency?.(item.number)}
            className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                colorMap[item.color],
              )}
            >
              <item.icon className="w-5 h-5" />
            </div>
            <div className="text-left">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {item.label}
              </p>
              <p className="font-semibold text-gray-900 dark:text-white">
                {item.number}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// =============================================================================
// SAFETY PREFERENCES SECTION
// =============================================================================

interface SafetyPreferencesSectionProps {
  preferences: SafetyPreferences;
  onUpdatePreferences?: (prefs: Partial<SafetyPreferences>) => void;
}

const SafetyPreferencesSection = ({
  preferences,
  onUpdatePreferences,
}: SafetyPreferencesSectionProps) => {
  const togglePreference = (key: keyof SafetyPreferences) => {
    if (typeof preferences[key] === "boolean") {
      onUpdatePreferences?.({ [key]: !preferences[key] });
    }
  };

  const preferenceItems = [
    {
      key: "autoShareTrips" as const,
      label: "Auto-share trips",
      description: "Automatically share trip with emergency contacts",
      icon: Share2,
    },
    {
      key: "crashDetectionEnabled" as const,
      label: "Crash detection",
      description: "Detect accidents using phone sensors",
      icon: AlertTriangle,
    },
    {
      key: "safetyCheckInsEnabled" as const,
      label: "Safety check-ins",
      description: "Periodic check-ins during trips",
      icon: Bell,
    },
    {
      key: "nightModeEnabled" as const,
      label: "Night safety mode",
      description: "Enhanced safety between 10 PM - 6 AM",
      icon: Shield,
    },
    {
      key: "womenSafetyMode" as const,
      label: "Women safety mode",
      description: "Additional safety features for women",
      icon: Heart,
    },
    {
      key: "requirePinVerification" as const,
      label: "PIN verification",
      description: "Verify driver with PIN before trip",
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
        <Settings className="w-5 h-5 text-gray-500" />
        <h2 className="font-semibold text-gray-900 dark:text-white">
          Safety Preferences
        </h2>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {preferenceItems.map((item) => (
          <div key={item.key} className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                <item.icon className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">
                  {item.label}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {item.description}
                </p>
              </div>
            </div>
            <button
              onClick={() => togglePreference(item.key)}
              className={cn(
                "w-12 h-7 rounded-full transition-colors relative",
                preferences[item.key]
                  ? "bg-green-500"
                  : "bg-gray-300 dark:bg-gray-600",
              )}
            >
              <div
                className={cn(
                  "w-5 h-5 rounded-full bg-white absolute top-1 transition-transform",
                  preferences[item.key] ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

// =============================================================================
// SAFETY TIPS SECTION
// =============================================================================

const SafetyTipsSection = () => {
  const tips = [
    "Share your trip with a trusted contact",
    "Verify driver and vehicle details before boarding",
    "Always sit in the back seat",
    "Keep your phone charged during trips",
    "Trust your instincts - end the trip if uncomfortable",
  ];

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-200 dark:border-blue-800 p-4">
      <div className="flex items-center gap-3 mb-3">
        <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <h2 className="font-semibold text-blue-900 dark:text-blue-100">
          Safety Tips
        </h2>
      </div>
      <ul className="space-y-2">
        {tips.map((tip, index) => (
          <li
            key={`safety-tip-${tip.slice(0, 20)}`}
            className="flex items-start gap-2 text-sm text-blue-800 dark:text-blue-200"
          >
            <span className="w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 flex items-center justify-center flex-shrink-0 text-xs font-medium text-blue-700 dark:text-blue-300">
              {index + 1}
            </span>
            {tip}
          </li>
        ))}
      </ul>
    </div>
  );
};

// =============================================================================
// EXPORTS
// =============================================================================

export {
  EmergencyContactsSection,
  EmergencyNumbersSection,
  SafetyPreferencesSection,
  SafetyTipsSection,
  SOSSection,
};
