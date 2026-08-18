/**
 * verifyTurnstile — verifica un token de Cloudflare Turnstile contra el
 * endpoint siteverify de Cloudflare. No exige sesión de usuario (se usa
 * antes de loguearse, en registro y "olvidé mi contraseña").
 *
 * Contrato: recibe { token } en el body JSON y devuelve:
 *  - { success: true } (200) si Cloudflare confirma el token.
 *  - { success: false } (403) si falta el token o Cloudflare lo rechaza.
 *  - { success: false } (500) si falta la secret key o hay error de red.
 * Nunca deja pasar por defecto.
 */
Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const token = body?.token;
    if (!token) {
      return Response.json({ success: false }, { status: 403 });
    }
    const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!secret) {
      return Response.json({ success: false }, { status: 500 });
    }
    const form = new URLSearchParams();
    form.append("secret", secret);
    form.append("response", String(token));
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return Response.json({ success: false }, { status: 500 });
    }
    const data = await res.json();
    if (data?.success === true) {
      return Response.json({ success: true });
    }
    return Response.json({ success: false }, { status: 403 });
  } catch (error) {
    return Response.json({ success: false }, { status: 500 });
  }
});