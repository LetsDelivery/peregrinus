/** The width of the sidebar the person drags to. It stays between a width that still shows the tools and one that leaves room to work. */

export const SIDE_DEFAULT = 300
export const SIDE_MIN = 220
export const SIDE_MAX = 560
/** The work area never gets narrower than this, on a small window the sidebar gives way. */
const WORK_MIN = 360
/** What an arrow key moves the edge by, in pixels. */
export const SIDE_STEP = 16

/** `width` held between the limits, as whole pixels; anything that is not a number is the default. */
export const clampSide = (width, viewport = Number.POSITIVE_INFINITY) => {
  if (!Number.isFinite(width)) {
    return SIDE_DEFAULT
  }
  const max = Math.min(SIDE_MAX, Math.max(SIDE_MIN, viewport - WORK_MIN))
  return Math.round(Math.min(Math.max(width, SIDE_MIN), max))
}
