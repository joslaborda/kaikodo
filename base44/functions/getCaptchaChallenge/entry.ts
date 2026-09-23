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

async function hashIp(req: Request): Promise<string | null> {
  const raw = req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (!raw) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("kaikodo-captcha:" + raw));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
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

    // Hallazgo del escáner de seguridad de Base44 (14 sep 2026): esta
    // función es y tiene que seguir siendo sin sesión (se usa ANTES de
    // registrarse/resetear contraseña, no hay ningún usuario con el que
    // comparar todavía) -- eso no es el bug en sí, es el motivo por el que
    // el escáner no puede "arreglarlo solo". Lo que sí faltaba: nada
    // impedía a un script llamarla en bucle sin límite, creando registros
    // de CaptchaChallenge sin fin (coste de base de datos, no fuga de
    // datos -- un reto sin resolver no sirve para registrarse ni resetear
    // nada, verifyCaptcha exige la prueba-de-trabajo real).
    // Mitigación: si ya hay demasiados retos sin usar y sin caducar
    // todavía, se corta aquí en vez de seguir creando más -- quien esté de
    // verdad intentando registrarse legítimamente apenas nota nada (el
    // tráfico normal está muy por debajo de este umbral); quien esté
    // abusando tiene que esperar a que caduquen los suyos.
    const MAX_PENDING_CHALLENGES = 300;
    const pending = await service.entities.CaptchaChallenge.filter({ used: false });

    // Escáner (24 sep 2026): el tope global de arriba evitaba llenar la base
    // de datos, pero un solo script podía agotarlo y dejar a todo el mundo sin
    // poder registrarse (denegación de servicio). Ahora, además, cada IP solo
    // puede tener unos pocos retos pendientes a la vez. La IP no se guarda en
    // claro: solo un hash, que caduca con el reto (TTL de 2 minutos).
    const MAX_PENDING_PER_IP = 5;
    const ipHash = await hashIp(req);
    if (ipHash) {
      const nowMs = Date.now();
      const mine = pending.filter((r: any) => r.ip_hash === ipHash && new Date(r.expires_at).getTime() >= nowMs);
      if (mine.length >= MAX_PENDING_PER_IP) {
        return Response.json(
          { error: "Demasiadas solicitudes ahora mismo. Inténtalo de nuevo en un momento." },
          { status: 429 }
        );
      }
    }

    if (pending.length >= MAX_PENDING_CHALLENGES) {
      return Response.json(
        { error: "Demasiadas solicitudes ahora mismo. Inténtalo de nuevo en un momento." },
        { status: 429 }
      );
    }

    const challenge = randomChallenge();
    await service.entities.CaptchaChallenge.create({
      challenge,
      difficulty: DIFFICULTY_BITS,
      used: false,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + TTL_SECONDS * 1000).toISOString(),
      ...(ipHash ? { ip_hash: ipHash } : {}),
    });

    return Response.json({ challenge, difficulty: DIFFICULTY_BITS, expiresInSeconds: TTL_SECONDS });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});