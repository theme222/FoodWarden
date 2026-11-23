import type { SWRConfiguration } from "swr";
export class ApiRequestError extends Error {
  constructor(public readonly status: number) {
    super(`API request failed (${status})`);
  }
}
export function isAccessError(error: unknown): error is ApiRequestError {
  return (
    error instanceof ApiRequestError && [401, 403, 404].includes(error.status)
  );
}
export async function getJson<T>(
  url: string,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new ApiRequestError(response.status);
  return parse(await response.json());
}
export const swrOptions: SWRConfiguration = {
  revalidateOnFocus: true,
  errorRetryCount: 3,
  errorRetryInterval: 2000,
  shouldRetryOnError: (error) => !isAccessError(error),
};
