import type { Response } from 'supertest';

/**
 * On this development machine (macOS 12, 2-core), a small fraction of
 * supertest requests land on the WRONG ephemeral server - a scratch express
 * app in the parallel jest worker - via kernel port-recycling collisions.
 * The tell is unmistakable: an error status with either an empty body or
 * Express's default text/html error page, shapes this app can never produce
 * (every error path writes a JSON envelope; our only HTML responses are 200s).
 * Test SCAFFOLDING retries those with a loud warning. Assertions never retry -
 * a phantom reaching an assertion should fail the test.
 */
export const isPhantomResponse = (res: Response): boolean => {
  if (res.status < 400) return false;
  if (res.text === undefined || res.text === '') return true;
  if ((res.headers['content-type'] ?? '').includes('text/html')) return true;
  // every Tambo error response carries a `code` field; an error body without
  // one (observed: Express default pages, third-party API envelopes) did not
  // come from this app
  const body = res.body as { code?: unknown } | undefined;
  return typeof body?.code !== 'string';
};

export const retryPhantom = async (
  send: () => Promise<Response>,
  label: string,
  attempts = 3,
): Promise<Response> => {
  let last: Response | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await send();
    if (!isPhantomResponse(last)) return last;
    console.warn(
      `[test-scaffold] phantom HTTP response (${last.status}, empty body) on ${label}, ` +
        `attempt ${attempt}/${attempts} - retrying`,
    );
  }
  return last!;
};
