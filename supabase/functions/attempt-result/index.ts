import { corsHeaders, json, getClients } from "../_shared/common.ts";

Deno.serve(async req => {
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  try{
    const {userClient,adminClient}=getClients(req);
    const {data:auth}=await userClient.auth.getUser();
    if(!auth.user)return json({error:"Unauthorized"},401);
    const {data:attempt,error}=await adminClient.from("quiz_attempts").select("*").eq("id",(await req.json()).attempt_id).single();
    if(error||!attempt)return json({error:"Attempt not found."},404);
    if(attempt.student_id!==auth.user.id){
      const {data:p}=await adminClient.from("profiles").select("role").eq("id",auth.user.id).single();
      if(!p||!["teacher","admin"].includes(p.role))return json({error:"Forbidden"},403);
    }
    const {data:answers}=await adminClient.from("quiz_answers").select("*").eq("attempt_id",attempt.id);
    const {data:questions}=await adminClient.from("quiz_questions").select("id,position,question_text,option_a,option_b,option_c,option_d,correct_option,explanation").eq("quiz_id",attempt.quiz_id).order("position");
    return json({ok:true,attempt,answers:answers||[],questions:questions||[]});
  }catch(e){return json({error:e instanceof Error?e.message:"Server error."},500)}
});
