export default function DeleteAccount() {
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', color: '#181818', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 4 }}>Eliminar tu cuenta de Kaikōdo</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>Última actualización: 25 de agosto de 2026</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Cómo eliminar tu cuenta</h2>
      <ol style={{ paddingLeft: 20 }}>
        <li>Abre la app Kaikōdo e inicia sesión.</li>
        <li>Ve a tu perfil (icono de usuario, abajo a la derecha) → <strong>Ajustes</strong>.</li>
        <li>Baja hasta el final y toca <strong>Eliminar cuenta</strong>.</li>
        <li>Confirma. La cuenta se elimina al momento, sin periodo de espera.</li>
      </ol>
      <p>
        Si no puedes acceder a la app pero quieres solicitar el borrado igualmente,
        escribe a <a href="mailto:hello@kaikodo.app">hello@kaikodo.app</a> desde el
        email de tu cuenta.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Qué se elimina</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li>Tu perfil (nombre, foto, username).</li>
        <li>Tus notificaciones, "me gusta" y comentarios.</li>
        <li>Tu lista de la maleta en cada viaje.</li>
        <li>Los spots y documentos que subiste marcados como personales (visibles solo para ti).</li>
      </ul>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Qué se conserva, y por qué</h2>
      <p>
        Si perteneces a viajes con otras personas, parte de tu contenido está
        entrelazado con el de ellas: un gasto que pagaste forma parte del cálculo
        de saldos de todo el grupo, y un mensaje de chat es parte de una
        conversación compartida. Borrar esos registros de golpe rompería las
        cuentas o el hilo de conversación de gente que no ha pedido borrar nada.
      </p>
      <p>Por eso, en esos casos concretos:</p>
      <ul style={{ paddingLeft: 20 }}>
        <li>
          <strong>Gastos compartidos:</strong> se conserva el importe y el cálculo,
          pero tu email se sustituye por un identificador anónimo — deja de estar
          asociado a ti.
        </li>
        <li>
          <strong>Spots y documentos marcados como compartidos con el grupo:</strong>{' '}
          se conservan, pero se anonimiza quién los creó.
        </li>
        <li>
          <strong>Mensajes de chat:</strong> se conserva el texto (contexto de la
          conversación para el resto), pero se anonimiza el autor.
        </li>
      </ul>
      <p>
        Sales inmediatamente de todos tus viajes al confirmar el borrado, así que
        pierdes acceso a esos contenidos aunque queden anonimizados para los demás.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Contacto</h2>
      <p>
        Dudas sobre este proceso: <a href="mailto:hello@kaikodo.app">hello@kaikodo.app</a>.
        Más detalle sobre qué datos tratamos y con qué base legal, en nuestra{' '}
        <a href="/Privacy">política de privacidad</a>.
      </p>
    </div>
  );
}
