import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getLockoutStatus, recordFailedAttempt, resetFailedAttempts } from "@/lib/auth/lockout";
import { setSessionCookie } from "@/lib/auth/session";
import { verifyTotpCode } from "@/lib/auth/totp";

const bodySchema = z.object({
  code: z.string().trim().min(1),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let code: string;
  try {
    const body = bodySchema.parse(await request.json());
    code = body.code;
  } catch {
    return NextResponse.json(
      { error: "Invalid request payload" },
      {
        status: 400,
      },
    );
  }

  const currentLockout = await getLockoutStatus();
  if (currentLockout.isLocked) {
    return NextResponse.json(
      {
        error: "Too many failed attempts. Try again later.",
        lockout: currentLockout,
      },
      { status: 423 },
    );
  }

  const valid = verifyTotpCode(code);
  if (!valid) {
    const lockout = await recordFailedAttempt();
    return NextResponse.json(
      {
        error: lockout.isLocked
          ? "Too many failed attempts. Try again later."
          : "Invalid authenticator code",
        lockout,
      },
      { status: lockout.isLocked ? 423 : 401 },
    );
  }

  await resetFailedAttempts();

  const response = NextResponse.json({ success: true });
  await setSessionCookie(response);
  return response;
}
