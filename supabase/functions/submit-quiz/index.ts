import { corsHeaders, json, getClients } from "../_shared/common.ts";

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { userClient, adminClient } = getClients(req);
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) return json({ error:"Unauthorized" },401);

    const { data: profile } = await adminClient.from("profiles").select("id,role").eq("id",authData.user.id).single();
    if (!profile || profile.role !== "student") return json({ error:"Student access required." },403);

    const body = await req.json();
    const quizId = String(body.quiz_id || "");
    const submitted = body.answers || {};
    if (!quizId) return json({ error:"Quiz ID is required." },400);

    const { data: student } = await adminClient.from("student_profiles").select("class_no").eq("user_id",profile.id).single();
    const { data: quiz, error: quizError } = await adminClient.from("quizzes").select("*").eq("id",quizId).single();
    if (quizError || !quiz) return json({ error:"Quiz not found." },404);
    if (quiz.class_no !== student?.class_no) return json({ error:"This quiz is not for your class." },403);
    if (!quiz.is_active) return json({ error:"This quiz is not active." },400);
    if (quiz.start_at && new Date(quiz.start_at) > new Date()) return json({ error:"This quiz has not started yet." },400);
    if (quiz.end_at && new Date(quiz.end_at) < new Date()) return json({ error:"This quiz has ended." },400);

    const { data: existing } = await adminClient.from("quiz_attempts").select("id").eq("quiz_id",quizId).eq("student_id",profile.id).maybeSingle();
    if (existing) return json({ error:"You have already submitted this quiz." },400);

    const { data: questions, error:qerr } = await adminClient.from("quiz_questions").select("*").eq("quiz_id",quizId).order("position");
    if (qerr) return json({ error:qerr.message },400);
    if (!questions?.length) return json({ error:"Quiz has no questions." },400);

    let score=0, correct=0, wrong=0, unattempted=0;
    const answerRows:any[]=[];
    const resultQuestions:any[]=[];

    for (const q of questions) {
      const selected = submitted[q.id] || null;
      let status="unattempted", marks=0;
      if (!selected) { unattempted++; }
      else if (selected === q.correct_option) { status="correct"; marks=Number(q.correct_marks ?? 4); score+=marks; correct++; }
      else { status="wrong"; marks=Number(q.wrong_marks ?? -1); score+=marks; wrong++; }

      answerRows.push({ question_id:q.id, selected_option:selected, status, marks_awarded:marks });
      resultQuestions.push({
        id:q.id, position:q.position, question_text:q.question_text,
        option_a:q.option_a, option_b:q.option_b, option_c:q.option_c, option_d:q.option_d,
        correct_option:q.correct_option, explanation:q.explanation
      });
    }

    const { data: attempt, error:aerr } = await adminClient.from("quiz_attempts").insert({
      quiz_id:quizId, student_id:profile.id, score, total_marks:quiz.total_marks,
      correct_count:correct, wrong_count:wrong, unattempted_count:unattempted
    }).select().single();
    if (aerr) return json({ error:aerr.message },400);

    const { error: ansErr } = await adminClient.from("quiz_answers").insert(answerRows.map(x=>({...x,attempt_id:attempt.id})));
    if (ansErr) {
      await adminClient.from("quiz_attempts").delete().eq("id",attempt.id);
      return json({ error:ansErr.message },400);
    }

    return json({ ok:true, attempt, answers:answerRows, questions:resultQuestions });
  } catch(e) {
    return json({ error:e instanceof Error?e.message:"Server error." },500);
  }
});
