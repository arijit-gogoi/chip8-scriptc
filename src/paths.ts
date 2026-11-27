/** Last path segment, accepting both separators. */
export function baseName(path: string): string {
  let start = 0;
  for (let k = 0; k < path.length; k++) {
    const code = path.charCodeAt(k);
    if (code === 47 || code === 92) start = k + 1;
  }
  return path.slice(start);
}
