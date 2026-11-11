import { handleCitiesGet } from "@/lib/session-handlers";

import type { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const response = await handleCitiesGet(req);
  return response;
}
