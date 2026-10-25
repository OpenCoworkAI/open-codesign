export async function resolve(specifier, context, nextResolve) {
  const staticOperationCatalogue =
    /(?:^|[\\/])apps[\\/]desktop[\\/]src[\\/]debug[\\/]operations\.ts(?:\?.*)?$/.test(specifier);
  if (
    /electron|playwright|puppeteer|robotjs|nut-js/.test(specifier) ||
    (/apps[\\/]desktop/.test(specifier) && !staticOperationCatalogue)
  ) {
    throw new Error('GUI dependency attempted by CLI');
  }
  return nextResolve(specifier, context);
}
