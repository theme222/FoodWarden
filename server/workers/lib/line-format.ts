export const LINE_MAX_TEXT_LENGTH = 5000;
export const LINE_MAX_MESSAGES_PER_REQUEST = 5;

function safeSliceText(text: string, maxUnits: number): string {
  if (maxUnits <= 0) return "";
  if (text.length <= maxUnits) return text;
  let end = maxUnits;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    end -= 1;
  }
  return text.slice(0, end);
}

export function capLineText(
  text: string,
  maxUnits = LINE_MAX_TEXT_LENGTH,
  suffix = "…",
): string {
  if (maxUnits <= 0) return "";
  if (text.length <= maxUnits) return text;
  if (maxUnits <= suffix.length) return safeSliceText(text, maxUnits);
  return safeSliceText(text, maxUnits - suffix.length) + suffix;
}

export function summarizeLineItems(
  items: string[],
  maxUnits: number,
  formatOmitted: (omittedCount: number) => string,
  separator = ", ",
): string {
  if (items.length === 0) return "";
  const full = items.join(separator);
  if (full.length <= maxUnits) return full;

  const maxSuffixLength = formatOmitted(items.length).length;
  const budget = Math.max(1, maxUnits - maxSuffixLength);
  const kept: string[] = [];
  let used = 0;

  for (const item of items) {
    const addition =
      kept.length === 0 ? item.length : separator.length + item.length;
    if (used + addition > budget) break;
    kept.push(item);
    used += addition;
  }

  if (kept.length === 0) {
    const first = capLineText(items[0]!, budget);
    const omitted = items.length - 1;
    return omitted > 0 ? first + formatOmitted(omitted) : first;
  }

  const omitted = items.length - kept.length;
  return kept.join(separator) + (omitted > 0 ? formatOmitted(omitted) : "");
}
