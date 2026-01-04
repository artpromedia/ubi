/**
 * Sidebar / Navigation Component
 *
 * Collapsible sidebar navigation for dashboard layouts.
 */

"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Sheet, SheetContent, SheetTrigger } from "./sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

// Sidebar context for managing collapsed state
interface SidebarContextValue {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isMobile: boolean;
}

const SidebarContext = React.createContext<SidebarContextValue | undefined>(
  undefined
);

export const useSidebar = () => {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

// Sidebar provider
interface SidebarProviderProps {
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

export const SidebarProvider = ({
  children,
  defaultCollapsed = false,
}: SidebarProviderProps) => {
  const [isCollapsed, setIsCollapsed] = React.useState(defaultCollapsed);
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed, isMobile }}>
      {children}
    </SidebarContext.Provider>
  );
};

// Main sidebar component
interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  collapsible?: boolean;
}

const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  ({ className, collapsible = true, children, ...props }, ref) => {
    const { isCollapsed, setIsCollapsed, isMobile } = useSidebar();

    // Mobile sidebar uses Sheet
    if (isMobile) {
      return (
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden fixed left-4 top-4 z-40"
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <nav className="flex h-full flex-col">{children}</nav>
          </SheetContent>
        </Sheet>
      );
    }

    return (
      <aside
        ref={ref}
        className={cn(
          "relative flex h-full flex-col border-r bg-background transition-all duration-300",
          isCollapsed ? "w-16" : "w-64",
          className
        )}
        {...props}
      >
        {children}
        {collapsible && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute -right-3 top-6 z-10 h-6 w-6 rounded-full border bg-background"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronLeft className="h-3 w-3" />
            )}
            <span className="sr-only">
              {isCollapsed ? "Expand" : "Collapse"} sidebar
            </span>
          </Button>
        )}
      </aside>
    );
  }
);
Sidebar.displayName = "Sidebar";

// Sidebar header
const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { isCollapsed } = useSidebar();
  return (
    <div
      ref={ref}
      className={cn(
        "flex h-16 items-center border-b px-4",
        isCollapsed && "justify-center px-2",
        className
      )}
      {...props}
    />
  );
});
SidebarHeader.displayName = "SidebarHeader";

// Sidebar content
const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex-1 overflow-y-auto py-4", className)}
    {...props}
  />
));
SidebarContent.displayName = "SidebarContent";

// Sidebar footer
const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { isCollapsed } = useSidebar();
  return (
    <div
      ref={ref}
      className={cn(
        "border-t p-4",
        isCollapsed && "px-2",
        className
      )}
      {...props}
    />
  );
});
SidebarFooter.displayName = "SidebarFooter";

// Sidebar group (for organizing nav items)
interface SidebarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
}

const SidebarGroup = React.forwardRef<HTMLDivElement, SidebarGroupProps>(
  ({ className, label, children, ...props }, ref) => {
    const { isCollapsed } = useSidebar();
    return (
      <div ref={ref} className={cn("px-3 py-2", className)} {...props}>
        {label && !isCollapsed && (
          <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </h3>
        )}
        {label && isCollapsed && (
          <div className="mb-2 border-t border-border" />
        )}
        <div className="space-y-1">{children}</div>
      </div>
    );
  }
);
SidebarGroup.displayName = "SidebarGroup";

// Sidebar navigation item
const sidebarItemVariants = cva(
  "flex w-full items-center rounded-md text-sm font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "hover:bg-accent hover:text-accent-foreground",
        active: "bg-accent text-accent-foreground",
      },
      size: {
        default: "h-10 px-3",
        sm: "h-8 px-2 text-xs",
        lg: "h-12 px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

interface SidebarItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof sidebarItemVariants> {
  icon?: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  active?: boolean;
  asChild?: boolean;
}

const SidebarItem = React.forwardRef<HTMLButtonElement, SidebarItemProps>(
  (
    { className, variant, size, icon, label, badge, active, ...props },
    ref
  ) => {
    const { isCollapsed } = useSidebar();

    const content = (
      <button
        ref={ref}
        className={cn(
          sidebarItemVariants({
            variant: active ? "active" : variant,
            size,
          }),
          isCollapsed && "justify-center px-2",
          className
        )}
        {...props}
      >
        {icon && (
          <span className={cn("shrink-0", !isCollapsed && "mr-3")}>{icon}</span>
        )}
        {!isCollapsed && (
          <>
            <span className="flex-1 truncate text-left">{label}</span>
            {badge && <span className="ml-auto">{badge}</span>}
          </>
        )}
      </button>
    );

    if (isCollapsed) {
      return (
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>{content}</TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-4">
              {label}
              {badge && <span>{badge}</span>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return content;
  }
);
SidebarItem.displayName = "SidebarItem";

// Sidebar link (anchor version)
interface SidebarLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof sidebarItemVariants> {
  icon?: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  active?: boolean;
}

const SidebarLink = React.forwardRef<HTMLAnchorElement, SidebarLinkProps>(
  ({ className, variant, size, icon, label, badge, active, ...props }, ref) => {
    const { isCollapsed } = useSidebar();

    const content = (
      <a
        ref={ref}
        className={cn(
          sidebarItemVariants({
            variant: active ? "active" : variant,
            size,
          }),
          isCollapsed && "justify-center px-2",
          className
        )}
        {...props}
      >
        {icon && (
          <span className={cn("shrink-0", !isCollapsed && "mr-3")}>{icon}</span>
        )}
        {!isCollapsed && (
          <>
            <span className="flex-1 truncate">{label}</span>
            {badge && <span className="ml-auto">{badge}</span>}
          </>
        )}
      </a>
    );

    if (isCollapsed) {
      return (
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>{content}</TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-4">
              {label}
              {badge && <span>{badge}</span>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return content;
  }
);
SidebarLink.displayName = "SidebarLink";

export {
    Sidebar, SidebarContent,
    SidebarFooter,
    SidebarGroup, SidebarHeader, SidebarItem, sidebarItemVariants, SidebarLink
};

