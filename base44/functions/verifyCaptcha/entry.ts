import { createClientFromRequest } from "npm:@base44/sdk";

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function hasLeadingZeroBits(hex, bits) {
  const fullNibbles = Math.floor(bits / 4);
  const remBits = bits % 4;
  for (let i = 0; i < fullNibbles; i++) { if (hex[i] !== "0") return false; }
  if (remBits === 0) return true;
  const nibble = parseInt(hex[fullNibbles], 16);
  return (nibble >> (4 - remBits)) === 0;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { token } = await req.json();

    if (typeof token !== "string" || !token.includes(".")) {
      return Response.json({ success: false, error: "Token inválido" }, { status: 400 });
    }
    const dotIdx = token.lastIndexOf(".");
    const challenge = token.slice(0, dotIdx);
    const nonce = token.slice(dotIdx + 1);
    if (!challenge || !nonce || !/^\d+$/.test(nonce)) {
      return Response.json({ success: false, error: "Token inválido" }, { status: 400 });
    }

    const service = base44.asServiceRole;
    const rows = await service.entities.CaptchaChallenge.filter({ challenge });
    const row = rows[0];

    const fail = () => Response.json({ success: false }, { status: 400 });

    if (!row || row.used) return fail();
    if (new Date(row.expires_at).getTime() < Date.now()) return fail();

    const hex = await sha256Hex(`${challenge}:${nonce}`);
    if (!hasLeadingZeroBits(hex, row.difficulty)) return fail();

    await service.entities.CaptchaChallenge.update(row.id, { used: true });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});