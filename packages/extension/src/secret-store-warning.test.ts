import { describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "./connection.js";
import { MEMORY_SECRET_STORE_WARNING, watchSecretStore } from "./secret-store-warning.js";

function fakeConnection(secretStore: "keychain" | "memory" | Error) {
  const fns = new Set<(s: ConnectionState) => void>();
  const call = vi.fn(async () => {
    if (secretStore instanceof Error) throw secretStore;
    return { apiVersion: 1, secretStore };
  });
  return {
    connection: {
      onStateChange(fn: (s: ConnectionState) => void) {
        fns.add(fn);
        return { dispose: () => fns.delete(fn) };
      },
      call,
    },
    call,
    emit: (s: ConnectionState) => {
      for (const fn of [...fns]) fn(s);
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("watchSecretStore", () => {
  it("warns once in production when the service uses the memory store", async () => {
    const c = fakeConnection("memory");
    const warn = vi.fn();
    watchSecretStore({ connection: c.connection, production: true, warn });
    c.emit("connected");
    await settle();
    c.emit("unavailable");
    c.emit("connected");
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(MEMORY_SECRET_STORE_WARNING);
    expect(c.call).toHaveBeenCalledWith("health.get", {});
  });

  it("does not warn for the keychain", async () => {
    const c = fakeConnection("keychain");
    const warn = vi.fn();
    watchSecretStore({ connection: c.connection, production: true, warn });
    c.emit("connected");
    await settle();
    expect(warn).not.toHaveBeenCalled();
  });

  it("never checks outside production (dev/test hosts use the memory store on purpose)", async () => {
    const c = fakeConnection("memory");
    const warn = vi.fn();
    watchSecretStore({ connection: c.connection, production: false, warn });
    c.emit("connected");
    await settle();
    expect(c.call).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores a failing health call and checks again on the next connect", async () => {
    const c = fakeConnection(new Error("down"));
    const warn = vi.fn();
    watchSecretStore({ connection: c.connection, production: true, warn });
    c.emit("connected");
    await settle();
    c.emit("connected");
    await settle();
    expect(c.call).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops listening when disposed", async () => {
    const c = fakeConnection("memory");
    const warn = vi.fn();
    watchSecretStore({ connection: c.connection, production: true, warn }).dispose();
    c.emit("connected");
    await settle();
    expect(warn).not.toHaveBeenCalled();
  });
});
