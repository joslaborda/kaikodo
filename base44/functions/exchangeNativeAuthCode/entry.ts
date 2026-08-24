import { createClientFromRequest } from "npm:@base44/sdk";

async function sha256Base64Url(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  let str = "";
  for (const b of new Uint8Array(digest)) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { code, code_verifier } = await req.json();

    if (
      typeof code !== "string" || !code ||
      typeof code_verifier !== "string" || !code_verifier
    ) {
      return Response.json({ error: "Parámetros inválidos" }, { status: 400 });
    }

    const service = base44.asServiceRole;
    const rows = await service.entities.NativeAuthCode.filter({ code });
    const row = rows[0];

    const fail = () =>
      Response.json({ error: "Código inválido o caducado" }, { status: 400 });

    if (!row || row.used) return fail();
    if (new Date(row.expires_at).getTime() < Date.now()) return fail();

    const expectedChallenge = await sha256Base64Url(code_verifier);
    if (expectedChallenge !== row.code_challenge) return fail();

    await service.entities.NativeAuthCode.update(row.id, { used: true });

    return Response.json({ access_token: row.access_token });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});