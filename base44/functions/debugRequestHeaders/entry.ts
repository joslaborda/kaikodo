// TEMPORAL — diagnóstico de cabeceras IP de la petición. Borrar tras el análisis.
// Sin sesión a propósito: solo devuelve las cabeceras tal cual llegan.

export default async function(req: Request): Promise<Response> {
  try {
    const names = [
      "x-forwarded-for",
      "x-real-ip",
      "cf-connecting-ip",
      "true-client-ip",
      "x-client-ip",
      "forwarded",
      "fly-client-ip",
      "x-envoy-external-address",
      "x-original-forwarded-for",
      "x-vercel-forwarded-for",
    ];

    const headers: Record<string, string | null> = {};
    for (const name of names) {
      const value = req.headers.get(name);
      headers[name] = value === null ? null : value;
    }

    return Response.json({ headers });
  } catch (error) {
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}