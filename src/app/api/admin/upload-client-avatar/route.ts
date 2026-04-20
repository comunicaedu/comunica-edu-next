import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const user = await resolveApiUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.isAdmin) return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });

    const formData = await req.formData();
    const clientId = formData.get("clientId") as string;
    const file = formData.get("file") as File | null;

    if (!clientId || !file) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const admin = user.db;

    const mimeType = file.type || "image/jpeg";
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const path = `${clientId}/avatar.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Garante que o bucket "avatars" existe (cria se não existir)
    const { data: buckets } = await admin.storage.listBuckets();
    const bucketExists = buckets?.some((b) => b.name === "avatars");
    if (!bucketExists) {
      const { error: bucketErr } = await admin.storage.createBucket("avatars", { public: true });
      if (bucketErr && bucketErr.message !== "The resource already exists") {
        return NextResponse.json({ error: `Bucket error: ${bucketErr.message}` }, { status: 500 });
      }
    }

    // Upload using service role (bypasses RLS)
    const { error: storageErr } = await admin.storage
      .from("avatars")
      .upload(path, buffer, { upsert: true, contentType: mimeType });

    if (storageErr) {
      return NextResponse.json({ error: storageErr.message }, { status: 500 });
    }

    const { data: urlData } = admin.storage.from("avatars").getPublicUrl(path);
    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Use SECURITY DEFINER function — bypasses RLS completely
    const { error: rpcError } = await admin.rpc("admin_set_avatar_url", {
      p_user_id: clientId,
      p_avatar_url: avatarUrl,
    });

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    return NextResponse.json({ avatarUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
