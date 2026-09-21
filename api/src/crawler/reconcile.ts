export function computeStaleUrls(
  indexedUrls: string[],
  knownUrls: Set<string>,
): string[] {
  return indexedUrls.filter((url) => !knownUrls.has(url));
}
