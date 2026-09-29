import { corsHeaders, json, getClients } from "../_shared/common.ts";

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userClient, adminClient } = getClients(req);
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) return json({ error:"Unauthorized" },401);

    const { data: profile } = await adminClient
      .from("profiles")
      .select("id,role")
      .eq("id",authData.user.id)
      .single();
    if (!profile || profile.role !== "student") {
      return json({ error:"Student access required." },403);
    }

    const body = await req.json();
    const quizId = String(body.quiz_id || "");
    if (!quizId) return json({ error:"Quiz ID is required." },400);

    const { data: student } = await adminClient
      .from("student_profiles")
      .select("class_no")
      .eq("user_id",profile.id)
      .single();

    const { data: quiz, error: quizError } = await adminClient
      .from("quizzes")
      .select("id,class_no,title,duration_minutes,total_marks,start_at,end_at,is_active")
      .eq("id",quizId)
      .single();

    if (quizError || !quiz) return json({ error:"Quiz not found." },404);
    if (quiz.class_no !== student?.class_no) return json({ error:"This quiz is not for your class." },403);
    if (!quiz.is_active) return json({ error:"This quiz is not active." },400);

    const now = new Date();
    if (quiz.start_at && new Date(quiz.start_at) > now) return json({ error:"This quiz has not started yet." },400);
    if (quiz.end_at && new Date(quiz.end_at) < now) return json({ error:"This quiz has ended." },400);

    const { data: existingAttempt } = await adminClient
      .from("quiz_attempts")
      .select("id")
      .eq("quiz_id",quizId)
      .eq("student_id",profile.id)
      .maybeSingle();
    if (existingAttempt) return json({ error:"You have already submitted this quiz." },400);

    let { data: session } = await adminClient
      .from("quiz_sessions")
      .select("*")
      .eq("quiz_id",quizId)
      .eq("student_id",profile.id)
      .maybeSingle();

    if (session) {
      if (session.status !== "in_progress") {
        return json({ error:"This quiz session has already been closed." },400);
      }
      if (new Date(session.expires_at) <= now) {
        await adminClient.from("quiz_sessions").update({
          status:"expired",
          submitted_at:now.toISOString(),
          submission_reason:"expired"
        }).eq("id",session.id);
        return json({ error:"The quiz time has expired." },400);
      }
    } else {
      const startedAt = now;
      const durationEnd = new Date(startedAt.getTime() + Number(quiz.duration_minutes) * 60 * 1000);
      const quizEnd = quiz.end_at ? new Date(quiz.end_at) : null;
      const expiresAt = quizEnd && quizEnd < durationEnd ? quizEnd : durationEnd;

      const { data: created, error:createError } = await adminClient
        .from("quiz_sessions")
        .insert({
          quiz_id:quizId,
          student_id:profile.id,
          started_at:startedAt.toISOString(),
          expires_at:expiresAt.toISOString(),
          status:"in_progress"
        })
        .select()
        .single();

      if (createError) {
        // A second tab can race the first tab. Re-read the unique session.
        const { data: raced } = await adminClient
          .from("quiz_sessions")
          .select("*")
          .eq("quiz_id",quizId)
          .eq("student_id",profile.id)
          .maybeSingle();
        if (!raced) return json({ error:createError.message },400);
        session = raced;
      } else {
        session = created;
      }
    }

    const { data: questions, error:qerr } = await adminClient
      .from("quiz_questions")
      .select("id,quiz_id,position,question_text,option_a,option_b,option_c,option_d")
      .eq("quiz_id",quizId)
      .order("position");

    if (qerr) return json({ error:qerr.message },400);
    if (!questions?.length) return json({ error:"Quiz has no questions." },400);

    return json({
      ok:true,
      session_id:session.id,
      started_at:session.started_at,
      expires_at:session.expires_at,
      questions
    });
  } catch(e) {
    return json({ error:e instanceof Error?e.message:"Server error." },500);
  }
});
