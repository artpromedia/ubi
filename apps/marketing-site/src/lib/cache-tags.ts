/**
 * Data-cache tags and windows shared by the readers and the revalidation
 * route. Kept free of Next imports so route handlers and tests can use them.
 */
export const AVAILABILITY_TAG = "availability";
export const REQUIREMENTS_TAG = "requirements";

/** Board 24: revalidate availability every 300 s, plus on demand on config events. */
export const REVALIDATE_SECONDS = 300;
export const REQUIREMENTS_REVALIDATE_SECONDS = 3600;
