// Sends privacy-friendly email notifications (never includes message text).
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);

async function mail(uid: string | null, ar: string, en: string, fr: string) {
  if (!uid) return;
  const { data } = await sb.auth.admin.getUserById(uid);
  const to = data?.user?.email;
  if (!to) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("MAIL_FROM"), to,
      subject: `${en} / ${fr} / ${ar}`,
      text: `${ar}\n\n${en}\n\n${fr}\n\n${Deno.env.get("SITE_URL")}`,
    }),
  });
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) return new Response("unauthorized", { status: 401 });
  const { table, type, record: r, old_record: o } = await req.json();

  if (table === "messages" && type === "INSERT") {
    const { data: c } = await sb.from("conversations").select("seeker_id,provider_id").eq("id", r.conversation_id).single();
    const to = c?.seeker_id === r.sender_id ? c?.provider_id : c?.seeker_id;
    await mail(to, "لديك رسالة جديدة.", "You have a new message.", "Vous avez un nouveau message.");
  } else if (table === "conversations" && type === "UPDATE" && !o.provider_id && r.provider_id) {
    await mail(r.seeker_id, "تم قبول طلبك، يمكنك بدء المحادثة.", "Your request was accepted. You can start chatting.", "Votre demande a été acceptée. Vous pouvez discuter.");
  } else if (table === "applications" && type === "UPDATE" && o.status !== r.status) {
    const ok = r.status === "approved";
    await mail(r.user_id,
      ok ? "تمت الموافقة على طلبك كمقدم دعم." : "نأسف، لم تتم الموافقة على طلبك.",
      ok ? "Your Support Provider application was approved." : "Sorry, your application was not approved.",
      ok ? "Votre candidature a été approuvée." : "Désolé, votre candidature n'a pas été retenue.");
  } else if (table === "profiles" && type === "UPDATE" && o.status !== r.status && r.status === "suspended") {
    await mail(r.id, "تم تعليق حسابك من قبل الإدارة.", "Your account was suspended by the administrators.", "Votre compte a été suspendu par l'équipe.");
  }
  return new Response("ok");
});
