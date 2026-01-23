/**
 * Bottom Sheet
 *
 * Mobile-optimized bottom sheet component with drag-to-dismiss
 * and snap points for flexible content display.
 */

import {
  motion,
  type PanInfo,
  useAnimation,
  useDragControls,
} from "framer-motion";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";

export interface BottomSheetProps {
  /** Whether the sheet is open */
  isOpen: boolean;
  /** Callback when sheet should close */
  onClose: () => void;
  /** Sheet content */
  children: React.ReactNode;
  /** Title shown in header */
  title?: string;
  /** Description shown below title */
  description?: string;
  /** Snap points as percentages of viewport height */
  snapPoints?: number[];
  /** Initial snap point index */
  initialSnap?: number;
  /** Whether to show the drag handle */
  showDragHandle?: boolean;
  /** Whether to show close button */
  showCloseButton?: boolean;
  /** Whether clicking backdrop closes the sheet */
  closeOnBackdrop?: boolean;
  /** Additional class name */
  className?: string;
}

export const BottomSheet = ({
  isOpen,
  onClose,
  children,
  title,
  description,
  snapPoints = [0.5, 0.9],
  initialSnap = 0,
  showDragHandle = true,
  showCloseButton = true,
  closeOnBackdrop = true,
  className,
}: BottomSheetProps) => {
  const controls = useAnimation();
  const dragControls = useDragControls();
  const [currentSnap, setCurrentSnap] = React.useState(initialSnap);
  const sheetRef = React.useRef<HTMLDivElement>(null);

  const windowHeight = typeof window !== "undefined" ? window.innerHeight : 800;

  React.useEffect(() => {
    if (isOpen) {
      controls.start({
        y: windowHeight * (1 - snapPoints[initialSnap]),
        transition: { type: "spring", damping: 30, stiffness: 300 },
      });
    } else {
      controls.start({
        y: windowHeight,
        transition: { type: "spring", damping: 30, stiffness: 300 },
      });
    }
  }, [isOpen, controls, windowHeight, snapPoints, initialSnap]);

  const handleDragEnd = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    const velocity = info.velocity.y;
    const offset = info.offset.y;

    // If dragged down quickly or far, close
    if (velocity > 500 || offset > 100) {
      onClose();
      return;
    }

    // If dragged up quickly, snap to highest point
    if (velocity < -500) {
      const highestSnap = snapPoints.length - 1;
      setCurrentSnap(highestSnap);
      controls.start({
        y: windowHeight * (1 - snapPoints[highestSnap]),
        transition: { type: "spring", damping: 30, stiffness: 300 },
      });
      return;
    }

    // Find nearest snap point
    const currentY = windowHeight * (1 - snapPoints[currentSnap]) + offset;
    const snapPositions = snapPoints.map((sp) => windowHeight * (1 - sp));
    let nearestSnap = 0;
    let minDistance = Math.abs(currentY - snapPositions[0]);

    snapPositions.forEach((pos, index) => {
      const distance = Math.abs(currentY - pos);
      if (distance < minDistance) {
        minDistance = distance;
        nearestSnap = index;
      }
    });

    setCurrentSnap(nearestSnap);
    controls.start({
      y: snapPositions[nearestSnap],
      transition: { type: "spring", damping: 30, stiffness: 300 },
    });
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={closeOnBackdrop ? onClose : undefined}
        className="fixed inset-0 bg-black/50 z-40"
      />

      {/* Sheet */}
      <motion.div
        ref={sheetRef}
        drag="y"
        dragControls={dragControls}
        dragConstraints={{ top: 0 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
        animate={controls}
        initial={{ y: windowHeight }}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-gray-900 rounded-t-3xl shadow-xl",
          "touch-none",
          className,
        )}
        style={{ height: windowHeight * 0.95 }}
      >
        {/* Drag Handle */}
        {showDragHandle && (
          <div
            className="flex justify-center py-3 cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => dragControls.start(e)}
          >
            <div className="w-12 h-1.5 rounded-full bg-gray-300 dark:bg-gray-700" />
          </div>
        )}

        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-4 pb-3 border-b border-gray-100 dark:border-gray-800">
            <div>
              {title && (
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {description}
                </p>
              )}
            </div>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-2 -mr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto h-full pb-safe">
          <div className="px-4 py-4">{children}</div>
        </div>
      </motion.div>
    </>
  );
};
