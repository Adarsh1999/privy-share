import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { isAuthenticatedRequest } from "@/lib/auth/session";
import { createFileItem, createLinkItem, createTextItem, listItems } from "@/lib/storage/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () =>
  NextResponse.json(
    { error: "Unauthorized" },
    {
      status: 401,
    },
  );

export async function GET(request: NextRequest) {
  const authenticated = await isAuthenticatedRequest(request);
  if (!authenticated) {
    return unauthorized();
  }

  const items = await listItems();
  const publicItems = items.map((item) => {
    const { blobName, ...publicItem } = item;
    void blobName;
    return publicItem;
  });

  return NextResponse.json({
    items: publicItems,
  });
}

export async function POST(request: NextRequest) {
  const authenticated = await isAuthenticatedRequest(request);
  if (!authenticated) {
    return unauthorized();
  }

  try {
    const form = await request.formData();
    const kind = String(form.get("kind") ?? "").trim();

    if (kind === "text") {
      const item = await createTextItem({
        title: String(form.get("title") ?? ""),
        text: String(form.get("text") ?? ""),
      });

      return NextResponse.json({ item: { ...item, blobName: undefined } }, { status: 201 });
    }

    if (kind === "link") {
      const item = await createLinkItem({
        title: String(form.get("title") ?? ""),
        url: String(form.get("url") ?? ""),
        note: String(form.get("note") ?? ""),
      });

      return NextResponse.json({ item: { ...item, blobName: undefined } }, { status: 201 });
    }

    if (kind === "file") {
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "File is required" }, { status: 400 });
      }

      const item = await createFileItem({
        title: String(form.get("title") ?? ""),
        file,
      });

      return NextResponse.json({ item: { ...item, blobName: undefined } }, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid item type" }, { status: 400 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Validation failed" }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to create item";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
