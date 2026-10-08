import { AsyncLocalStorage } from 'node:async_hooks';

import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  userId: number | null;
  ipAddress: string | null;
  userAgent: string | null;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** ผู้กระทำของ action ปัจจุบัน — null เมื่อระบบเป็นผู้ทำเอง (BR-09 ยอมให้ null ได้) */
export function getCurrentUserId(): number | null {
  return storage.getStore()?.userId ?? null;
}

export function setCurrentUserId(userId: number | null): void {
  const store = storage.getStore();

  if (store) {
    store.userId = userId;
  }
}

export function getElapsedMs(): number | null {
  const store = storage.getStore();
  return store ? Date.now() - store.startedAt : null;
}

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

const MAX_IP_LENGTH = 45;
const MAX_USER_AGENT_LENGTH = 500;

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const context: RequestContext = {
    userId: null,
    ipAddress: truncate(req.ip ?? req.socket.remoteAddress, MAX_IP_LENGTH),
    userAgent: truncate(req.headers['user-agent'], MAX_USER_AGENT_LENGTH),
    startedAt: Date.now(),
  };

  runWithRequestContext(context, next);
}

function truncate(value: string | undefined, max: number): string | null {
  if (!value) {
    return null;
  }

  return value.length > max ? value.slice(0, max) : value;
}
