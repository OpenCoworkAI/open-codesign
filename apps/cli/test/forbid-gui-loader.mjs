export async function resolve(specifier, context, nextResolve) {
  if (
    /electron|playwright|puppeteer|robotjs|nut-js/.test(specifier) ||
    /apps[\\/]desktop/.test(specifier)
  ) {
    throw new Error('GUI dependency attempted by CLI');
  }
  return nextResolve(specifier, context);
}
