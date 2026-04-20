import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

/**
 * POST /api/consume-feature
 * Consumes one credit of a feature for the authenticated user.
 * Uses service_role to bypass RLS (client_features UPDATE requires is_admin()).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await resolveApiUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { feature_key } = await req.json();
    if (!feature_key) return NextResponse.json({ error: "Missing feature_key" }, { status: 400 });

    const db = user.db;

    // Get current feature
    const { data: row, error: fetchErr } = await db
      .from("client_features")
      .select("limit_value, enabled")
      .eq("user_id", user.userId)
      .eq("feature_key", feature_key)
      .maybeSingle();

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

    // Feature not found or disabled
    if (!row || !row.enabled) return NextResponse.json({ error: "Feature disabled", remaining: 0 }, { status: 403 });

    // No limit set = unlimited
    if (row.limit_value === null || row.limit_value === undefined) {
      return NextResponse.json({ success: true, remaining: null });
    }

    // Already at zero
    if (row.limit_value <= 0) {
      return NextResponse.json({ error: "No credits remaining", remaining: 0 }, { status: 403 });
    }

    const next = row.limit_value - 1;

    const { error: updateErr } = await db
      .from("client_features")
      .update({ limit_value: next })
      .eq("user_id", user.userId)
      .eq("feature_key", feature_key);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ success: true, remaining: next });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
