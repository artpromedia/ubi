/**
 * UBI Design System
 *
 * Shared UI components for all UBI web applications.
 * Built on Radix UI primitives with Tailwind CSS styling.
 *
 * @packageDocumentation
 */

// ===========================================
// Theme & Design Tokens
// ===========================================
export {
  darkModeVariables,
  generateCSSVariables,
  globalStyles,
  lightModeVariables,
} from "./theme/css-variables";
export { ubiPreset } from "./theme/preset";
export * from "./theme/tokens";

// ===========================================
// Utility Functions
// ===========================================
export { cn } from "./lib/utils";

// ===========================================
// Core Components
// ===========================================
export { Button, buttonVariants } from "./components/button";
export type { ButtonProps } from "./components/button";

export { Input } from "./components/input";
export type { InputProps } from "./components/input";

export {
  AutoResizeTextarea,
  Textarea,
  TextareaWithCount,
  textareaVariants,
} from "./components/textarea";

export { Label } from "./components/label";

export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
} from "./components/card";

export { Badge, badgeVariants } from "./components/badge";
export type { BadgeProps } from "./components/badge";

export {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "./components/avatar";

export { Separator } from "./components/separator";

export {
  Skeleton,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonText,
} from "./components/skeleton";

export { DotsSpinner, PulseSpinner, Spinner } from "./components/spinner";

export { Alert, AlertDescription, AlertTitle } from "./components/alert";

export { CircularProgress, Progress } from "./components/progress";

// ===========================================
// Form Components
// ===========================================
export { Checkbox } from "./components/checkbox";

export {
  RadioCard,
  RadioGroup,
  RadioGroupItem,
  RadioOption,
} from "./components/radio-group";

export { Switch } from "./components/switch";

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./components/select";

// Form components (requires react-hook-form as peer dependency)
// Temporarily disabled due to React 19 compatibility issues
// export {
//   Form,
//   FormControl,
//   FormDescription,
//   FormField,
//   FormFieldWrapper,
//   FormItem,
//   FormLabel,
//   FormMessage,
//   useFormField,
// } from "./components/form";

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandSeparator,
  CommandShortcut,
} from "./components/command";

export { Combobox, MultiCombobox } from "./components/combobox";
export type {
  ComboboxOption,
  ComboboxProps,
  MultiComboboxProps,
} from "./components/combobox";

export {
  Calendar,
  DatePicker,
  DateRangePicker,
  DateRangePickerWithPresets,
} from "./components/date-picker";
export type { DateRange, DateRangePreset } from "./components/date-picker";

export {
  FilePreview,
  FileUpload,
  dropzoneVariants,
  formatFileSize,
} from "./components/file-upload";
export type { FileWithPreview, UploadedFile } from "./components/file-upload";

// ===========================================
// Overlay Components
// ===========================================
export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./components/dialog";

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
  ConfirmDialog,
} from "./components/alert-dialog";

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from "./components/sheet";

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./components/dropdown-menu";

export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "./components/popover";

export {
  SimpleTooltip,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/tooltip";

export {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  getToastIcon,
} from "./components/toast";

// ===========================================
// Navigation Components
// ===========================================
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/tabs";

export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  SimpleBreadcrumb,
} from "./components/breadcrumb";
export type { BreadcrumbItemData } from "./components/breadcrumb";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
  SidebarLink,
  SidebarProvider,
  sidebarItemVariants,
  useSidebar,
} from "./components/sidebar";

// ===========================================
// Data Display Components
// ===========================================
export {
  DataTable,
  DataTableColumnHeader,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  getSelectionColumn,
} from "./components/data-table";

export {
  CompactStats,
  StatsCard,
  StatsGrid,
  StatsTrend,
  statsTrendVariants,
} from "./components/stats-card";

export {
  EmptyFolder,
  EmptyState,
  ErrorState,
  NoData,
  NoResults,
  NotFound,
  emptyStateVariants,
} from "./components/empty-state";

export {
  LiveLocation,
  ServiceStatus,
  StatusDot,
  StatusBadge as StatusIndicatorBadge,
  StatusTimeline,
  statusBadgeVariants,
  statusDotVariants,
} from "./components/status-indicator";
export type {
  TimelineStep,
  UBIServiceType,
} from "./components/status-indicator";

// ===========================================
// UBI-Specific Components (Legacy)
// ===========================================
// Legacy StatusBadge - use StatusIndicatorBadge for new code
export { StatusBadge } from "./components/status-badge";

// ===========================================
// Primitives
// ===========================================
export * from "./primitives";

// ===========================================
// Action Components (New)
// ===========================================
export { IconButton, iconButtonVariants } from "./components/icon-button";
export type { IconButtonProps } from "./components/icon-button";

export { Link, linkVariants } from "./components/link";
export type { LinkProps } from "./components/link";

export { ButtonGroup, buttonGroupVariants } from "./components/button-group";
export type { ButtonGroupProps } from "./components/button-group";

// ===========================================
// Enhanced Form Components
// ===========================================
export { SearchInput } from "./components/search-input";
export type { SearchInputProps } from "./components/search-input";

export { OTPInput } from "./components/otp-input";
export type { OTPInputProps } from "./components/otp-input";

export { COUNTRIES, PhoneInput } from "./components/phone-input";
export type {
  PhoneInputProps,
  PhoneInputValue,
} from "./components/phone-input";

// ===========================================
// Feedback Components
// ===========================================
export { Banner, bannerVariants } from "./components/banner";
export type { BannerProps } from "./components/banner";

export {
  RatingDisplay,
  RatingInput,
  ratingVariants,
} from "./components/rating";
export type { RatingDisplayProps, RatingInputProps } from "./components/rating";

// ===========================================
// UBI Brand Components
// ===========================================
export { Logo, LogoIcon, UbiIcon, UbiLogo } from "./components/logo";
export type { LogoIconProps, LogoProps } from "./components/logo";

// ===========================================
// UBI Domain Components
// ===========================================
export * from "./components/ubi";
