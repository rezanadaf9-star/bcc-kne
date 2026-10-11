import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

export function getClients(req: Request, fallbackAccessToken = "") {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
  const header = req.headers.get("Authorization") || "";
  const auth = header || (fallbackAccessToken ? `Bearer ${fallbackAccessToken}` : "");
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const adminClient = createClient(url, secret);
  return { userClient, adminClient };
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Parse the body before auth so pagehide/sendBeacon can carry the current
    // access token in the body when the browser does not let us set headers.
    const body = await req.json();
    const accessToken = String(body.access_token || "");
    const { userClient, adminClient } = getClients(req, accessToken);

    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) return json({ error:"Unauthorized" },401);

    const { data: profile } = await adminClient
      .from("profiles")
      .select("id,role")
      .eq("id",authData.user.id)
      .single();
    if (!profile || profile.role !== "student") return json({ error:"Student access required." },403);

    const quizId = String(body.quiz_id || "");
    const sessionId = String(body.session_id || "");
    const submitted = body.answers || {};
    const submissionReason = String(body.submission_reason || "manual").slice(0,80);

    if (!quizId || !sessionId) return json({ error:"Quiz session is required." },400);

    const { data: student } = await adminClient
      .from("student_profiles")
      .select("class_no")
      .eq("user_id",profile.id)
      .single();

    const { data: session, error: sessionError } = await adminClient
      .from("quiz_sessions")
      .select("*")
      .eq("id",sessionId)
      .eq("student_id",profile.id)
      .eq("quiz_id",quizId)
      .single();

    if (sessionError || !session) return json({ error:"Quiz session not found." },404);
    if (session.status !== "in_progress") return json({ error:"This quiz session has already been submitted." },400);

    const { data: quiz, error: quizError } = await adminClient
      .from("quizzes")
      .select("*")
      .eq("id",quizId)
      .single();
    if (quizError || !quiz) return json({ error:"Quiz not found." },404);
    if (quiz.class_no !== student?.class_no) return json({ error:"This quiz is not for your class." },403);
    // The session was already authorized when the quiz was opened. Keep it
    // submittable even if staff deactivates the quiz or the quiz end_at is
    // reached while the student is sending the final answers.
    if (quiz.start_at && new Date(quiz.start_at) > new Date()) return json({ error:"This quiz has not started yet." },400);

    // Allow a short network grace period for an automatic submission at the
    // exact timer boundary, but do not allow a late manual submission.
    const now = Date.now();
    const expires = new Date(session.expires_at).getTime();
    const graceMs = 15000;
    if (now > expires + graceMs) {
      await adminClient.from("quiz_sessions").update({
        status:"expired",
        submission_reason:"expired"
      }).eq("id",session.id);
      return json({ error:"The quiz time has expired. Your session was closed." },400);
    }

    const { data: existing } = await adminClient
      .from("quiz_attempts")
      .select("id")
      .eq("quiz_id",quizId)
      .eq("student_id",profile.id)
      .maybeSingle();
    if (existing) {
      await adminClient.from("quiz_sessions").update({
        status:"submitted",
        submitted_at:new Date().toISOString(),
        submission_reason:submissionReason
      }).eq("id",session.id);
      return json({ error:"You have already submitted this quiz." },400);
    }

    const { data: questions, error:qerr } = await adminClient
      .from("quiz_questions")
      .select("*")
      .eq("quiz_id",quizId)
      .order("position");
    if (qerr) return json({ error:qerr.message },400);
    if (!questions?.length) return json({ error:"Quiz has no questions." },400);

    let score=0, correct=0, wrong=0, unattempted=0;
    const answerRows:any[]=[];
    const resultQuestions:any[]=[];

    for (const q of questions) {
      const selected = submitted[q.id] || null;
      let status="unattempted", marks=0;
      if (!selected) {
        unattempted++;
      } else if (selected === q.correct_option) {
        status="correct";
        marks=Number(q.correct_marks ?? 4);
        score+=marks;
        correct++;
      } else {
        status="wrong";
        marks=Number(q.wrong_marks ?? -1);
        score+=marks;
        wrong++;
      }

      answerRows.push({
        question_id:q.id,
        selected_option:selected,
        status,
        marks_awarded:marks
      });

      resultQuestions.push({
        id:q.id,
        position:q.position,
        question_text:q.question_text,
        option_a:q.option_a,
        option_b:q.option_b,
        option_c:q.option_c,
        option_d:q.option_d,
        correct_option:q.correct_option,
        explanation:q.explanation
      });
    }

    const { data: attempt, error:aerr } = await adminClient
      .from("quiz_attempts")
      .insert({
        quiz_id:quizId,
        student_id:profile.id,
        score,
        total_marks:quiz.total_marks,
        correct_count:correct,
        wrong_count:wrong,
        unattempted_count:unattempted,
        started_at:session.started_at,
        submission_reason:submissionReason
      })
      .select()
      .single();

    if (aerr) return json({ error:aerr.message },400);

    const { error: ansErr } = await adminClient
      .from("quiz_answers")
      .insert(answerRows.map(x=>({...x,attempt_id:attempt.id})));

    if (ansErr) {
      await adminClient.from("quiz_attempts").delete().eq("id",attempt.id);
      return json({ error:ansErr.message },400);
    }

    await adminClient.from("quiz_sessions").update({
      status:"submitted",
      submitted_at:new Date().toISOString(),
      submission_reason:submissionReason
    }).eq("id",session.id);

    return json({
      ok:true,
      attempt,
      answers:answerRows,
      questions:resultQuestions
    });
  } catch(e) {
    return json({ error:e instanceof Error?e.message:"Server error." },500);
  }
});
