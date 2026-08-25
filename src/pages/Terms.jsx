import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Borrador estándar de Términos de Servicio, con contacto (hello@kaikodo.app)
// y ley aplicable (España) ya rellenados. Sigue sin sustituir una revisión
// legal real por un abogado antes de un lanzamiento serio — cubre lo básico
// de un servicio en beta con gastos compartidos entre usuarios e información
// de viaje no oficial, pero no ha sido validado profesionalmente.
const CONTENT = {
  es: {
    title: 'Términos de servicio',
    updated: 'Última actualización: 22 de julio de 2026',
    sections: [
      {
        h: '1. Aceptación de los términos',
        p: [
          'Al crear una cuenta y usar Kaikōdo aceptas estos Términos de Servicio y la Política de Privacidad. Si no estás de acuerdo, no debes usar la aplicación.',
        ],
      },
      {
        h: '2. Qué es Kaikōdo',
        p: [
          'Kaikōdo es una aplicación para planificar viajes en grupo: itinerarios, documentos de viaje, gastos compartidos entre los miembros de un viaje, y una capa social de recomendaciones (spots) entre usuarios.',
          'Kaikōdo está actualmente en versión beta. Esto significa que puede contener errores, cambiar de funcionamiento sin previo aviso, o sufrir interrupciones. Se ofrece "tal cual", sin garantías de disponibilidad, precisión o continuidad del servicio.',
        ],
      },
      {
        h: '3. Tu cuenta',
        p: [
          'Eres responsable de mantener segura tu cuenta y de toda la actividad que ocurra en ella. Debes darnos información veraz al registrarte (nombre, país, etc.).',
          'Nos reservamos el derecho a suspender o eliminar cuentas que incumplan estos términos.',
        ],
      },
      {
        h: '4. Contenido que subes',
        p: [
          'Todo lo que subas a Kaikōdo (recomendaciones de sitios, fotos, documentos, mensajes, comentarios) sigue siendo tuyo. Al subirlo, nos das permiso para almacenarlo y mostrarlo dentro de la app a las personas con las que lo compartes (miembros del viaje, o públicamente si así lo eliges).',
          'Eres responsable de no subir contenido ilegal, que infrinja derechos de terceros, o documentos de otras personas sin su consentimiento.',
        ],
      },
      {
        h: '5. Gastos compartidos',
        p: [
          'La función de gastos de Kaikōdo es una calculadora de reparto entre los miembros de un viaje: registra quién pagó qué y calcula quién debe a quién. Kaikōdo no procesa pagos ni transferencias de dinero — el pago real entre personas ocurre fuera de la app, por el medio que elijáis.',
          'No nos hacemos responsables de que los pagos acordados entre miembros del viaje se lleguen a realizar.',
        ],
      },
      {
        h: '6. Información de requisitos de viaje',
        p: [
          'La información sobre visados, vacunas, embajadas y requisitos de entrada que muestra Kaikōdo es orientativa y puede estar desactualizada o ser incorrecta. No sustituye la información oficial de la embajada, consulado o autoridad migratoria del país de destino.',
          'Eres responsable de verificar los requisitos de entrada de cada país directamente en la fuente oficial antes de viajar. Kaikōdo no se hace responsable de decisiones de viaje tomadas basándose únicamente en esta información.',
        ],
      },
      {
        h: '7. Limitación de responsabilidad',
        p: [
          'En la medida permitida por la ley, Kaikōdo se ofrece sin garantías de ningún tipo. No somos responsables de pérdidas indirectas, pérdida de datos, ni de las consecuencias de decisiones de viaje tomadas usando la app.',
        ],
      },
      {
        h: '8. Cambios en estos términos',
        p: [
          'Podemos actualizar estos términos. Si el cambio es relevante, te lo notificaremos dentro de la app y, si corresponde, te pediremos que los aceptes de nuevo.',
        ],
      },
      {
        h: '9. Ley aplicable',
        p: [
          'Estos términos se rigen por la legislación española. Si resides en la Unión Europea, esto no afecta a los derechos de protección al consumidor que te correspondan por la normativa de tu país de residencia.',
        ],
      },
      {
        h: '10. Contacto',
        p: [
          'Para cualquier duda sobre estos términos: hello@kaikodo.app.',
        ],
      },
    ],
  },
  en: {
    title: 'Terms of service',
    updated: 'Last updated: July 22, 2026',
    sections: [
      {
        h: '1. Acceptance of terms',
        p: [
          'By creating an account and using Kaikōdo, you accept these Terms of Service and the Privacy Policy. If you do not agree, you must not use the app.',
        ],
      },
      {
        h: '2. What Kaikōdo is',
        p: [
          'Kaikōdo is a group trip-planning app: itineraries, travel documents, expenses shared between trip members, and a social layer of place recommendations between users.',
          'Kaikōdo is currently in beta. This means it may contain bugs, change behavior without notice, or experience downtime. It is provided "as is", without guarantees of availability, accuracy, or continuity of service.',
        ],
      },
      {
        h: '3. Your account',
        p: [
          'You are responsible for keeping your account secure and for all activity on it. You must provide accurate information when signing up (name, country, etc.).',
          'We reserve the right to suspend or delete accounts that violate these terms.',
        ],
      },
      {
        h: '4. Content you upload',
        p: [
          'Anything you upload to Kaikōdo (place recommendations, photos, documents, messages, comments) remains yours. By uploading it, you grant us permission to store it and display it within the app to the people you share it with (trip members, or publicly if you choose to).',
          'You are responsible for not uploading illegal content, content that infringes on others\' rights, or other people\'s documents without their consent.',
        ],
      },
      {
        h: '5. Shared expenses',
        p: [
          'Kaikōdo\'s expense feature is a split calculator between trip members: it records who paid for what and calculates who owes whom. Kaikōdo does not process payments or money transfers — actual payment between people happens outside the app, by whatever means you choose.',
          'We are not responsible for whether payments agreed between trip members actually take place.',
        ],
      },
      {
        h: '6. Travel requirement information',
        p: [
          'Information about visas, vaccines, embassies, and entry requirements shown in Kaikōdo is for guidance only and may be outdated or incorrect. It does not replace official information from the embassy, consulate, or immigration authority of the destination country.',
          'You are responsible for verifying entry requirements for each country directly with the official source before traveling. Kaikōdo is not responsible for travel decisions made based solely on this information.',
        ],
      },
      {
        h: '7. Limitation of liability',
        p: [
          'To the extent permitted by law, Kaikōdo is provided without warranties of any kind. We are not liable for indirect losses, data loss, or the consequences of travel decisions made using the app.',
        ],
      },
      {
        h: '8. Changes to these terms',
        p: [
          'We may update these terms. If the change is significant, we will notify you within the app and, where applicable, ask you to accept them again.',
        ],
      },
      {
        h: '9. Governing law',
        p: [
          'These terms are governed by Spanish law. If you live in the European Union, this does not affect any consumer-protection rights you have under the law of your country of residence.',
        ],
      },
      {
        h: '10. Contact',
        p: [
          'For any questions about these terms: hello@kaikodo.app.',
        ],
      },
    ],
  },
};

export default function Terms() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language?.startsWith('en') ? 'en' : 'es';
  const c = CONTENT[lang];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-5 pt-[calc(env(safe-area-inset-top,0px)+3rem)] pb-16">
        <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6 hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
          {lang === 'es' ? 'Volver a Kaikōdo' : 'Back to Kaikōdo'}
        </button>
        <h1 className="text-2xl font-semibold text-foreground mb-1">{c.title}</h1>
        <p className="text-xs text-muted-foreground mb-8">{c.updated}</p>
        <div className="space-y-6">
          {c.sections.map((s, i) => (
            <div key={i}>
              <h2 className="text-base font-medium text-foreground mb-2">{s.h}</h2>
              {s.p.map((para, j) => (
                <p key={j} className="text-sm text-muted-foreground leading-relaxed mb-2">{para}</p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}