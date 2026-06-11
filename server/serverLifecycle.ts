import type http from 'node:http';

export function closeServer(server: http.Server, done: () => void): void {
  if (!server.listening) {
    done();
    return;
  }
  server.close(() => {
    done();
  });
}
