import net from "node:net";

export const SINGLE_INSTANCE_EXIT_CODE = 73;
const WINDOWS_PIPE = "\\\\.\\pipe\\terratectra-anon-chat-network-v1";

export class AlreadyRunningError extends Error {
  constructor() {
    super("The TerraTectra bot network is already running on this computer");
    this.name = "AlreadyRunningError";
    this.code = "EALREADYRUNNING";
  }
}

export function acquireSingleInstance(endpoint = WINDOWS_PIPE) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.end());
    const onError = (error) => {
      server.close();
      reject(error?.code === "EADDRINUSE" ? new AlreadyRunningError() : error);
    };
    server.once("error", onError);
    server.listen(endpoint, () => {
      server.off("error", onError);
      server.unref();
      let released = false;
      resolve({
        endpoint,
        release() {
          if (released) return Promise.resolve();
          released = true;
          return new Promise((closeResolve) => server.close(closeResolve));
        }
      });
    });
  });
}
