import { corsHeaders, json, getClients } from "../_shared/common.ts";

function authEmail(loginId: string) {
  const domain = Deno.env.get("AUTH_EMAIL_DOMAIN") || "students.bcc-portal.invalid";
  return `${loginId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "")}@${domain}`;
}
function makeLoginId(batch: string, classNo: number, name: string) {
  const letters = name.replace(/[^A-Za-z]/g, "").toUpperCase().padEnd(2,"X").slice(0,2);
  const random = Math.floor(100 + Math.random()*900);
  return `${batch}BCC${classNo}${letters}@${random}`;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { userClient, adminClient } = getClients(req);
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) return json({ error: "Unauthorized" }, 401);

    const { data: caller } = await adminClient.from("profiles").select("role").eq("id", authData.user.id).single();
    if (!caller || !["admin","teacher"].includes(caller.role)) return json({ error: "Staff access required." }, 403);

    const body = await req.json();
    if (body.type !== "student") return json({ error: "Only student creation is supported by this endpoint." }, 400);
    const full_name = String(body.full_name || "").trim();
    const class_no = Number(body.class_no);
    const roll_number = String(body.roll_number || "").trim();
    const batch = String(body.batch || "");
    const password = String(body.password || "");
    if (!full_name || ![10,12].includes(class_no) || !["26","27"].includes(batch) || password.length < 8)
      return json({ error: "Name, class, batch and an 8+ character password are required." }, 400);

    let login_id = makeLoginId(batch,class_no,full_name);
    for (let i=0;i<10;i++) {
      const { data: exists } = await adminClient.from("profiles").select("id").eq("login_id",login_id).maybeSingle();
      if (!exists) break;
      login_id = makeLoginId(batch,class_no,full_name);
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: authEmail(login_id),
      password,
      email_confirm: true,
      user_metadata: { full_name, login_id, role: "student" }
    });
    if (createError || !created.user) return json({ error: createError?.message || "Could not create auth user." }, 400);

    const userId = created.user.id;
    const { error: profileError } = await adminClient.from("profiles").insert({
      id:userId, role:"student", full_name, login_id
    });
    if (profileError) {
      await adminClient.auth.admin.deleteUser(userId);
      return json({ error: profileError.message }, 400);
    }
    const { error: studentError } = await adminClient.from("student_profiles").insert({
      user_id:userId, class_no, roll_number, batch
    });
    if (studentError) {
      await adminClient.from("profiles").delete().eq("id",userId);
      await adminClient.auth.admin.deleteUser(userId);
      return json({ error: studentError.message }, 400);
    }

    return json({ ok:true, user_id:userId, login_id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Server error." }, 500);
  }
});
