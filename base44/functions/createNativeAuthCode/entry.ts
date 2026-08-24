import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * createNativeAuthCode — genera un código de intercambio de un solo uso
 * (patrón PKCE, RFC 7636) para el login nativo (Android/iOS).
 *
 * Por qué: el login nativo pasaba el access_token real, en texto plano, por
 * un custom URL scheme sin verificar (com.kaikodo.app://auth-callback).
 * Cualquier otra app en Android que declarase el mismo scheme podía competir
 * por recibir ese intent y quedarse con el token de sesión completo (ver
 * auditoría 19-ago-2026, hallazgo crítico #3).
 *
 * Ahora ese hop solo lleva un código opaco de un solo uso y vida corta. El
 * código por sí solo no vale nada: canjearlo (ver exchangeNativeAuthCode)
 * exige además el code_verifier original, que se genera y se queda siempre
 * en el almacenamiento local de la propia app nativa — nunca viaja por el
 * custom scheme ni por ningún sitio que una app maliciosa pueda interceptar.
 *
 * Esta función se llama desde el navegador externo (Chrome Custom Tab /
 * SFSafariViewController) justo después de que Base44 complete el login,
 * con la sesión real ya activa — por eso exige auth.me().
 */

const TTL_MS = 2 * 60 * 1000; // 2 minutos: tiempo de sobra para volver a la app, poco margen para abusar del código si se filtrase igualmente.

function randomCode() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }

    const { code_challenge, access_token } = await req.json();

    if (
      typeof code_challenge !== "string" ||
      code_challenge.length < 20 ||
      code_challenge.length > 200
    ) {
      return Response.json({ error: "code_challenge inválido" }, { status: 400 });
    }
    if (typeof access_token !== "string" || access_token.length < 10) {
      return Response.json({ error: "access_token inválido" }, { status: 400 });
    }

    const service = base44.asServiceRole;
    const now = Date.now();

    try {
      const stale = await service.entities.NativeAuthCode.filter({});
      const expired = stale.filter((r) => new Date(r.expires_at).getTime() < now);
      for (const row of expired.slice(0, 50)) {
        await service.entities.NativeAuthCode.delete(row.id).catch(() => {});
      }
    } catch {
    }

    const code = randomCode();
    await service.entities.NativeAuthCode.create({
      code,
      code_challenge,
      access_token,
      user_email: user.email,
      used: false,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + TTL_MS).toISOString(),
    });

    return Response.json({ code });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});