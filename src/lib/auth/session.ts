import { SignJWT, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

const SESSION_COOKIE = "privy_session";
const SESSION_ALGO = "HS256";

type SessionPayload = {
  authenticated: true;
};

const getSecretKey = (): Uint8Array => {
  return new TextEncoder().encode(getEnv().sessionSecret);
};

const createSessionToken = async (): Promise<string> => {
  const payload: SessionPayload = { authenticated: true };
  const env = getEnv();

  return new SignJWT(payload)
    .setProtectedHeader({ alg: SESSION_ALGO })
    .setIssuedAt()
    .setExpirationTime(`${env.sessionTtlHours}h`)
    .sign(getSecretKey());
};

const verifySessionToken = async (token: string): Promise<boolean> => {
  try {
    const { payload } = await jwtVerify<SessionPayload>(token, getSecretKey(), {
      algorithms: [SESSION_ALGO],
    });

    return payload.authenticated === true;
  } catch {
    return false;
  }
};

export const setSessionCookie = async (response: NextResponse): Promise<void> => {
  const token = await createSessionToken();
  const env = getEnv();

  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env.sessionTtlHours * 60 * 60,
  });
};

export const clearSessionCookie = (response: NextResponse): void => {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
};

export const isAuthenticatedRequest = async (request: NextRequest): Promise<boolean> => {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return false;
  }

  return verifySessionToken(token);
};
