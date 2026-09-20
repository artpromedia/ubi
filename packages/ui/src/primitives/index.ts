/**
 * UBI Design System - Primitives
 *
 * Low-level building blocks for composition.
 * These primitives follow the compound component pattern and
 * provide the foundation for higher-level components.
 */

// Layout primitives
export { Box, type BoxProps } from "./box";
export {
  Flex,
  FlexItem,
  flexVariants,
  flexItemVariants,
  type FlexProps,
} from "./flex";
export {
  Grid,
  GridItem,
  gridVariants,
  gridItemVariants,
  type GridProps,
} from "./grid";
export {
  Stack,
  HStack,
  stackVariants,
  hstackVariants,
  type StackProps,
  type HStackProps,
} from "./stack";
export { Container, containerVariants, type ContainerProps } from "./container";
export { Spacer, spacerVariants, type SpacerProps } from "./spacer";
export { Divider, dividerVariants, type DividerProps } from "./divider";

// Typography primitives
export { Text, textVariants, type TextProps } from "./text";

// Utility primitives
export { Icon, iconVariants, type IconProps } from "./icon";
export { VisuallyHidden, type VisuallyHiddenProps } from "./visually-hidden";
