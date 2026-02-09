import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthenticatedRequest } from "@/lib/auth/session";
import { getLockoutStatus } from "@/lib/auth/lockout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const [authenticated, lockout] = await Promise.all([
    isAuthenticatedRequest(request),
    getLockoutStatus(),
  ]);

  return NextResponse.json({ authenticated, lockout });
}
