import { handleRefreshPost } from "@/lib/session-handlers";

import type { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const response = await handleRefreshPost(req);
  return response;
}
