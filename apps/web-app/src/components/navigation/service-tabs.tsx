/**
 * Service Tab Selector
 *
 * The main navigation between UBI Move, UBI Bites, and UBI Send.
 */

"use client";

import { motion } from "framer-motion";
import { Car, Package, Utensils } from "lucide-react";

import { cn } from "@/lib/utils";
import { useUIStore, type ServiceTab } from "@/store";

const tabs: {
  id: ServiceTab;
  label: string;
  icon: typeof Car;
  color: string;
}[] = [
  { id: "move", label: "Move", icon: Car, color: "#1DB954" }, // UBI Green
  { id: "bites", label: "Bites", icon: Utensils, color: "#FF7545" }, // UBI Orange
  { id: "send", label: "Send", icon: Package, color: "#10AEBA" }, // UBI Teal
];

interface ServiceTabsProps {
  className?: string;
}

export const ServiceTabs = ({ className }: ServiceTabsProps) => {
  const { activeTab, setActiveTab } = useUIStore();

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1 rounded-full bg-gray-100 p-1 dark:bg-gray-800",
        className,
      )}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
              isActive
                ? "text-white"
                : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100",
            )}
            style={{
              color: isActive ? "#ffffff" : undefined,
            }}
          >
            {isActive && (
              <motion.div
                layoutId="service-tab-background"
                className="absolute inset-0 rounded-full"
                style={{ backgroundColor: tab.color }}
                transition={{ type: "spring", duration: 0.5 }}
              />
            )}
            <span className="relative flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * Compact version for mobile
 */
export const ServiceTabsCompact = ({ className }: ServiceTabsProps) => {
  const { activeTab, setActiveTab } = useUIStore();

  return (
    <div
      className={cn(
        "flex items-center justify-around border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900",
        className,
      )}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
              isActive
                ? "text-gray-900 dark:text-white"
                : "text-gray-500 dark:text-gray-400",
            )}
          >
            {isActive && (
              <motion.div
                layoutId="service-tab-indicator"
                className="absolute top-0 h-0.5 w-12 rounded-full"
                style={{ backgroundColor: tab.color }}
                transition={{ type: "spring", duration: 0.5 }}
              />
            )}
            <Icon
              className="h-5 w-5"
              style={{ color: isActive ? tab.color : undefined }}
            />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};
