import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}})}
function clients(req:Request){const url=Deno.env.get("SUPABASE_URL")!;const anon=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")!;const auth=req.headers.get("Authorization")||"";return {userClient:createClient(url,anon,{global:{headers:{Authorization:auth}}}),adminClient:createClient(url,secret)}}
function authEmail(loginId:string){const domain=Deno.env.get("AUTH_EMAIL_DOMAIN")||"students.bcc-portal.invalid";return `${loginId.trim().toLowerCase().replace(/[^a-z0-9._-]/g,"")}@${domain}`}
function makeStudentLoginId(batch:string,classNo:number,name:string){const letters=name.replace(/[^A-Za-z]/g,"").toUpperCase().padEnd(2,"X").slice(0,2);const random=Math.floor(100+Math.random()*900);return `${batch}BCC${classNo}${letters}@${random}`}
function generatedPassword(){const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";const bytes=crypto.getRandomValues(new Uint8Array(14));return Array.from(bytes,b=>chars[b%chars.length]).join("")}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 try{
  const {userClient,adminClient}=clients(req);const {data:authData}=await userClient.auth.getUser();if(!authData.user)return json({error:"Unauthorized"},401);
  const {data:caller}=await adminClient.from("profiles").select("role").eq("id",authData.user.id).single();if(!caller||caller.role!=="admin")return json({error:"Only an administrator can create accounts or manage teacher credentials."},403);
  const body=await req.json();
  if(body.action==="set-status"){
    const id=String(body.user_id||"");if(!id||typeof body.is_active!=="boolean")return json({error:"Teacher and status are required."},400);
    const {error}=await adminClient.from("profiles").update({is_active:body.is_active}).eq("id",id).eq("role","teacher");if(error)return json({error:error.message},400);return json({ok:true,is_active:body.is_active});
  }
  if(body.action==="reset-password"){
    const id=String(body.user_id||""),password=String(body.password||"");if(!id||password.length<8)return json({error:"Teacher and a password of at least 8 characters are required."},400);
    const {data:profile,error:profileError}=await adminClient.from("profiles").select("id,role,login_id").eq("id",id).single();if(profileError||!profile||profile.role!=="teacher")return json({error:"Teacher account not found."},404);
    const {error}=await adminClient.auth.admin.updateUserById(id,{password});if(error)return json({error:error.message},400);return json({ok:true,login_id:profile.login_id});
  }
  if(body.type==="teacher"){
    const full_name=String(body.full_name||"").trim();const password=String(body.password||generatedPassword());const class_nos=[...new Set((Array.isArray(body.class_nos)?body.class_nos:[]).map(Number))].filter(n=>[10,12].includes(n));
    const nameParts=full_name.split(/\s+/).filter(Boolean);
    if(nameParts.length<2)return json({error:"Enter the teacher's full name with at least a first name and a second name so the Teacher ID can include both initials."},400);
    if(!class_nos.length||password.length<8)return json({error:"Full name, at least one class, and an 8+ character password are required."},400);
    let login_id="";for(let i=0;i<10;i++){const {data,error}=await adminClient.rpc("next_bcc_teacher_id",{p_full_name:full_name});if(error)return json({error:`Teacher ID sequence is not installed. Run the teacher portal SQL migration first. ${error.message}`},400);login_id=String(data);const {data:exists}=await adminClient.from("profiles").select("id").eq("login_id",login_id).maybeSingle();if(!exists)break;login_id="";}if(!login_id)return json({error:"Could not allocate a unique teacher ID. Try again."},409);
    const {data:created,error:createError}=await adminClient.auth.admin.createUser({email:authEmail(login_id),password,email_confirm:true,user_metadata:{full_name,login_id,role:"teacher"}});if(createError||!created.user)return json({error:createError?.message||"Could not create authentication user."},400);
    const userId=created.user.id;const {error:profileError}=await adminClient.from("profiles").insert({id:userId,role:"teacher",full_name,login_id,is_active:true});if(profileError){await adminClient.auth.admin.deleteUser(userId);return json({error:profileError.message},400)}
    const assignments=class_nos.map(class_no=>({teacher_id:userId,class_no}));const {error:assignError}=await adminClient.from("teacher_class_assignments").insert(assignments);if(assignError){await adminClient.from("profiles").delete().eq("id",userId);await adminClient.auth.admin.deleteUser(userId);return json({error:assignError.message},400)}
    return json({ok:true,user_id:userId,login_id,full_name,class_nos});
  }
  if(body.type!=="student")return json({error:"Unsupported account type."},400);
  const full_name=String(body.full_name||"").trim();const class_no=Number(body.class_no);const roll_number=String(body.roll_number||"").trim();const batch=String(body.batch||"");const password=String(body.password||"");const phone=body.phone?String(body.phone).trim():null;
  if(!full_name||![10,12].includes(class_no)||!["26","27"].includes(batch)||password.length<8)return json({error:"Name, class, batch and an 8+ character password are required."},400);
  let login_id=makeStudentLoginId(batch,class_no,full_name);for(let i=0;i<10;i++){const {data:exists}=await adminClient.from("profiles").select("id").eq("login_id",login_id).maybeSingle();if(!exists)break;login_id=makeStudentLoginId(batch,class_no,full_name)}
  const {data:created,error:createError}=await adminClient.auth.admin.createUser({email:authEmail(login_id),password,email_confirm:true,user_metadata:{full_name,login_id,role:"student"}});if(createError||!created.user)return json({error:createError?.message||"Could not create auth user."},400);
  const userId=created.user.id;const {error:profileError}=await adminClient.from("profiles").insert({id:userId,role:"student",full_name,login_id,is_active:true});if(profileError){await adminClient.auth.admin.deleteUser(userId);return json({error:profileError.message},400)}
  const {error:studentError}=await adminClient.from("student_profiles").insert({user_id:userId,class_no,roll_number,batch,phone});if(studentError){await adminClient.from("profiles").delete().eq("id",userId);await adminClient.auth.admin.deleteUser(userId);return json({error:studentError.message},400)}return json({ok:true,user_id:userId,login_id});
 }catch(e){return json({error:e instanceof Error?e.message:"Server error."},500)}
});
