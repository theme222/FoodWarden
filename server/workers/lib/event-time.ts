// Allow RTC drift without letting a bad clock pin current state.
export const MAX_FUTURE_SKEW_S = 300;
export function eventTimeIsValid(timestampS: number, nowS: number): boolean {
  return (
    Number.isSafeInteger(timestampS) &&
    timestampS >= 0 &&
    timestampS <= Math.min(253402300799, nowS + MAX_FUTURE_SKEW_S)
  );
}
