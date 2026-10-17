import type { Request, Response } from "express";
import { env } from "../config/env";

export const ACCESS_TOKEN_COOKIE = "amana_access";
export const REFRESH_TOKEN_COOKIE = "amana_refresh";

const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};

  return header.split(";").reduce<Record<string, string>>((cookies, entry) => {
    const separator = entry.indexOf("=");
    if (separator < 1) return cookies;
    const name = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookie values rather than failing the whole request.
    }
    return cookies;
  }, {});
}

export function getCookie(req: Request, name: string): string | undefined {
  return parseCookieHeader(req.headers.cookie)[name];
}

export function hasAuthCookie(req: Request): boolean {
  const cookies = parseCookieHeader(req.headers.cookie);
  return Boolean(cookies[ACCESS_TOKEN_COOKIE] || cookies[REFRESH_TOKEN_COOKIE]);
}

function accessTokenMaxAgeMs(): number {
  const ttlSeconds = Number.parseInt(process.env.JWT_EXPIRES_IN ?? env.JWT_EXPIRES_IN, 10);
  return (Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 86_400) * 1_000;
}

const baseCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
};

export function setAuthCookies(
  res: Response,
  session: { accessToken: string; refreshToken: string },
): void {
  res.cookie(ACCESS_TOKEN_COOKIE, session.accessToken, {
    ...baseCookieOptions,
    maxAge: accessTokenMaxAgeMs(),
  });
  res.cookie(REFRESH_TOKEN_COOKIE, session.refreshToken, {
    ...baseCookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, baseCookieOptions);
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions);
}
