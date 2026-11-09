import { handleSessionGet } from "@/lib/session-handlers";

import type { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const response = await handleSessionGet(req);
  return response;
}
