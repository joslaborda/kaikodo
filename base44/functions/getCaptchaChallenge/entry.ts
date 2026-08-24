import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * getCaptchaChallenge — emite un reto de prueba-de-trabajo (estilo
 * hashcash) para el captcha propio de Kaikōdo. Sin sesión (se llama antes
 * de registrarse o antes de pedir el reset de contraseña).
 *
 * Por qué existe esto en vez de Cloudflare Turnstile: Turnstile no
 * funcionaba de forma fiable dentro del WebView nativo de la app (ver
 * src/lib/captcha.js para el detalle). Este reto no depende de ningún
 * script ni dominio externo -- el cliente lo resuelve con JS puro, así que
 * se comporta igual en web y en la app nativa.
 *
 * DIFFICULTY es el único mando que hace falta tocar para ajustar el
 * equilibrio UX/protección (más alto = más lento de resolver = más caro
 * para un bot) -- cambiarlo aquí no requiere ningún redeploy del frontend.
 */

const DIFFICULTY_BITS = 16; // ~65k intentos de media; unos 1-4s en un móvil normal
const TTL_SECONDS = 120;

function randomChallenge() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole;
    const now = Date.now();

    try {
      const stale = await service.entities.CaptchaChallenge.filter({});
      const expired = stale.filter((r) => new Date(r.expires_at).getTime() < now);
      for (const row of expired.slice(0, 50)) {
        await service.entities.CaptchaChallenge.delete(row.id).catch(() => {});
      }
    } catch {
    }

    const challenge = randomChallenge();
    await service.entities.CaptchaChallenge.create({
      challenge,
      difficulty: DIFFICULTY_BITS,
      used: false,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + TTL_SECONDS * 1000).toISOString(),
    });

    return Response.json({ challenge, difficulty: DIFFICULTY_BITS, expiresInSeconds: TTL_SECONDS });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});