import type { Server } from 'http';
import app from '../../src/app';

/**
 * ONE listening server per test suite, shared by every request in it.
 *
 * supertest's request(app) binds a fresh ephemeral server per request;
 * thousands of bind/close cycles per run is what drives the kernel
 * port-recycling collisions behind the "phantom response" artifact on this
 * machine (see tests/helpers/http.ts). request(server) against an
 * already-listening server reuses it - one bind per suite.
 */
let server: Server | undefined;

beforeAll(() => {
  server = app.listen(0);
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(() => resolve());
      // pending keep-alive-free sockets close with their responses; don't wait
      server.closeAllConnections?.();
    }),
);

export const testServer = (): Server => {
  if (!server) throw new Error('testServer used before beforeAll ran.');
  return server;
};
