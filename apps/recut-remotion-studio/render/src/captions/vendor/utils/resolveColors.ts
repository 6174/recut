const DEFAULT_COLOR = "#FFFFFF";

export function resolveColors(primaryColor?: string, secondaryColor?: string) {
  if (!primaryColor && !secondaryColor) {
    return { primary: DEFAULT_COLOR, secondary: DEFAULT_COLOR };
  }
  if (primaryColor && !secondaryColor) {
    return { primary: primaryColor, secondary: primaryColor };
  }
  if (!primaryColor && secondaryColor) {
    return { primary: secondaryColor, secondary: secondaryColor };
  }
  return { primary: primaryColor!, secondary: secondaryColor! };
}
