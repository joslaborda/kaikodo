import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * searchUserProfiles — lee UserProfile con campos filtrados, en vez de dejar
 * que el cliente haga UserProfile.list()/.filter({}) directo.
 *
 * Por qué: UserProfile.read estaba en `true` sin restricción — necesario
 * porque hay varias pantallas que buscan/listan perfiles de OTRA gente
 * (avatares de miembros del viaje, buscador de comunidad, invitar por
 * username...), y el motor de rls de Base44 no proyecta campos (es todo o
 * nada) ni puede expresar "cualquier autenticado, pero no público". Con
 * read:true, cualquier usuario logueado podía volcar TODOS los campos de
 * TODOS los perfiles con una sola llamada — incluidos email, nationality y
 * second_nationality, que nunca se muestran en ninguna pantalla pública de
 * la app (confirmado revisando Explore.jsx/CommunitySearch.jsx: solo pintan
 * username/display_name/avatar/home_country).
 *
 * Distinción clave para no romper nada: cuando quien llama YA conoce el
 * email de la persona (porque está en trip.members, un array que ya podía
 * leer de todas formas) — modos `emails`/`userIds` — devolver ese mismo
 * email de vuelta no revela nada nuevo, así que se incluye (varias pantallas
 * ya indexan sus resultados por email y dependían de tenerlo). Cuando la
 * búsqueda es abierta y quien llama NO tiene ya esa información — modos
 * `usernameQuery`/`all`, el vector real de "descubrir a cualquiera" — el
 * email nunca se incluye. `nationality`/`second_nationality`/`home_currency`/
 * `language`/`notif_*`/`terms_*` no se devuelven en NINGÚN modo: son
 * ajustes de cuenta, no datos que ninguna pantalla de la app muestre de otra
 * persona.
 */

const MAX_IDS = 25;

function safeProfile(p: any) {
  return {
    id: p.id,
    user_id: p.user_id,
    username: p.username || null,
    username_normalized: p.username_normalized || null,
    display_name: p.display_name || null,
    avatar_url: p.avatar_url || null,
    cover_image_url: p.cover_image_url || null,
    bio: p.bio || null,
    website: p.website || null,
    instagram: p.instagram || null,
    travel_style: p.travel_style || null,
    home_country: p.home_country || null,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { userIds, emails, usernameQuery, exact } = body || {};
    const service = base44.asServiceRole;

    // ── Modo con email ya conocido por quien llama: se puede devolver email ──
    if (Array.isArray(userIds) && userIds.length > 0) {
      const ids = userIds.filter((x: unknown) => typeof x === "string").slice(0, MAX_IDS);
      const rows = ids.length ? await service.entities.UserProfile.filter({ user_id: { $in: ids } }) : [];
      // Perfiles antiguos (creados antes del backfill de email) tienen
      // user_id pero no email guardado en UserProfile. Se resuelve aquí, con
      // asServiceRole (que sí puede leer User), igual que en el modo `emails`.
      const missingIds = rows.filter((p: any) => !p.email).map((p: any) => p.user_id).filter(Boolean);
      let emailById: Record<string, string> = {};
      if (missingIds.length) {
        const users = await service.entities.User.filter({ id: { $in: missingIds } });
        emailById = Object.fromEntries(users.map((u: any) => [u.id, (u.email || "").toLowerCase()]));
      }
      // Cierre de la fuga de emails: el modo userIds se usaba para resolver
      // el email de un perfil encontrado por username (un desconocido), lo
      // que dejaba a cualquier usuario autenticado aprender el email de
      // cualquiera con solo saber su user_id. Ahora solo se devuelve el
      // email si quien llama YA tiene una relación real con ese usuario:
      // es él mismo, o comparten al menos un viaje.
      const myTrips = await service.entities.Trip.filter({ members: { $elemMatch: { $eq: user.email.toLowerCase() } } });
      const myMemberEmails = new Set(
        (myTrips as any[]).flatMap((t: any) => t.members || []).map((e: string) => (e || "").toLowerCase()).filter(Boolean)
      );
      return Response.json({
        profiles: rows.map((p: any) => {
          const isSelf = p.user_id === user.id;
          const resolvedEmail = (p.email || emailById[p.user_id] || "").toLowerCase();
          const sharesTrip = !!resolvedEmail && myMemberEmails.has(resolvedEmail);
          const email = (isSelf || sharesTrip) ? (p.email || emailById[p.user_id] || null) : null;
          return { ...safeProfile(p), email };
        }),
      });
    }

    if (Array.isArray(emails) && emails.length > 0) {
      const normEmails = emails
        .map((e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
        .filter(Boolean)
        .slice(0, MAX_IDS);
      const direct = normEmails.length
        ? await service.entities.UserProfile.filter({ email: { $in: normEmails } })
        : [];
      // Perfiles antiguos (creados antes del backfill de email) no aparecen
      // en la búsqueda directa por email — mismo fallback que ya usaban
      // varios sitios del cliente (Avatar.jsx, MemberAvatarRow.jsx) antes de
      // este fix: resolver email→User→user_id→UserProfile para los que
      // falten.
      const foundEmails = new Set(direct.map((p: any) => (p.email || "").toLowerCase()).filter(Boolean));
      const missing = normEmails.filter((e: string) => !foundEmails.has(e));
      let extraWithEmail: any[] = [];
      if (missing.length) {
        const users = await service.entities.User.filter({ email: { $in: missing } });
        const ids = users.map((u: any) => u.id).filter(Boolean);
        const extra = ids.length ? await service.entities.UserProfile.filter({ user_id: { $in: ids } }) : [];
        extraWithEmail = extra.map((p: any) => ({
          ...p,
          email: (users.find((u: any) => u.id === p.user_id)?.email || "").toLowerCase(),
        }));
      }
      const all = [...direct, ...extraWithEmail];
      return Response.json({ profiles: all.map((p: any) => ({ ...safeProfile(p), email: p.email || null })) });
    }

    // ── Modo de descubrimiento abierto: nunca se devuelve email ──
    if (typeof usernameQuery === "string" && usernameQuery.trim()) {
      const q = usernameQuery.trim().toLowerCase();
      if (exact) {
        let rows = await service.entities.UserProfile.filter({ username_normalized: q });
        if (rows.length === 0) {
          rows = await service.entities.UserProfile.filter({ username: usernameQuery.trim() });
        }
        return Response.json({ profiles: rows.map(safeProfile) });
      }
      const all = await service.entities.UserProfile.list();
      const filtered = all
        .filter((p: any) => {
          const un = (p.username || "").toLowerCase();
          const dn = (p.display_name || "").toLowerCase();
          return un.includes(q) || dn.includes(q);
        })
        .slice(0, 25);
      return Response.json({ profiles: filtered.map(safeProfile) });
    }

    // ── mode "all" (o payload vacío): listado completo, campos públicos ──
    const rows = await service.entities.UserProfile.list();
    return Response.json({ profiles: rows.map(safeProfile) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});