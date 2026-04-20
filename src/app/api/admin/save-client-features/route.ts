import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  try {
    const user = await resolveApiUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.isAdmin) return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });

    const { userId, features, aiVinhetasLimit } = await req.json();
    if (!userId || !features) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const admin = user.db;

    // Delete existing features for this user, then re-insert
    await admin.from("client_features").delete().eq("user_id", userId);

    const rows = features.map((f: { feature_key: string; enabled: boolean; limit_value: number | null }) => ({
      user_id: userId,
      feature_key: f.feature_key,
      enabled: f.enabled,
      limit_value: f.limit_value ?? null,
    }));

    const { error: featError } = await admin.from("client_features").insert(rows);

    if (featError) {
      return NextResponse.json({ error: featError.message }, { status: 500 });
    }

    // Save AI vinhetas limit in profile
    if (typeof aiVinhetasLimit === "number") {
      await admin
        .from("profiles")
        .update({ ai_vinhetas_limit: aiVinhetasLimit })
        .eq("user_id", userId);
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
