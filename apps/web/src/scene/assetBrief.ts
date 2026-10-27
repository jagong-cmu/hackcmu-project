/**
 * The numbers the owner's room images must meet. One place, used by the
 * contrast test (src/theme/contrast.test.ts) and by the /scene-check dev page,
 * which measures the real files against them.
 */
/** Each image, AVIF or WebP. */
export const MaxImageBytes = 400 * 1024;
/** Delivered width in px. */
export const MinImageWidth = 2560;
/** The left part of the image that menu text can reach. */
export const LeftFraction = 0.45;
/**
 * The brightest allowed pixel (99th percentile) on that left part, as relative
 * luminance. With the scrim over it, menu text is then AA at every x it can reach.
 */
export const MaxLeftLuminance = 0.12;
