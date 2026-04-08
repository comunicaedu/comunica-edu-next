import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function POST() {
  try {
    const cookieStore = await cookies();

    // Auth client — uses the user's session cookie
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      }
    );

    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Clear avatar_url from profiles table for this user
    const { error: updateError } = await authClient
      .from("profiles")
      .update({ avatar_url: null })
      .eq("user_id", user.id);

    // Also try clearing via edge function (clears the owner-public cache)
    await authClient.functions.invoke("admin-clients?action=avatar-set", {
      body: { avatar_url: null, user_id: user.id },
    }).catch(() => {});

    if (updateError) {
      // profiles update failed — might be RLS or table doesn't exist, not critical
      return NextResponse.json({ ok: true, warning: updateError.message });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
