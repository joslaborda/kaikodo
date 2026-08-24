import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Borrador estándar de Política de Privacidad alineado con RGPD, con
// responsable y contacto ya rellenados (José Laborda Ubiria, persona física
// — hello@kaikodo.app — proyecto individual, no una sociedad
// constituida; el RGPD exige que el responsable sea una persona
// identificable de verdad, no solo el nombre de la marca). Sigue sin
// sustituir una revisión legal real por un abogado: si en algún momento se
// constituye una empresa, se contratan proveedores nuevos, o se supera
// cierto volumen de usuarios, hay que revisar si hace falta un DPO y si la
// base legal de cada tratamiento sigue siendo la correcta.
const CONTENT = {
  es: {
    title: 'Política de privacidad',
    updated: 'Última actualización: 22 de julio de 2026',
    sections: [
      {
        h: '1. Responsable del tratamiento',
        p: ['José Laborda Ubiria, como responsable de Kaikōdo. Contacto: hello@kaikodo.app.'],
      },
      {
        h: '2. Qué datos recogemos',
        p: [
          'Datos de cuenta: email, nombre, nombre de usuario, foto de perfil.',
          'Datos de viaje: nacionalidad, país y moneda de residencia, itinerarios, documentos que subas (billetes, reservas), gastos, mensajes del chat de cada viaje, spots (lugares) que guardes o recomiendes.',
          'Datos técnicos: idioma preferido, y los mínimos necesarios para el funcionamiento del servicio (identificadores de sesión).',
        ],
      },
      {
        h: '3. Para qué los usamos y con qué base legal',
        p: [
          'Prestar el servicio (crear tu itinerario, calcular gastos compartidos, mostrar tus documentos a quien decidas) — base legal: ejecución del contrato de uso de la app (art. 6.1.b RGPD).',
          'Notificaciones dentro de la app (invitaciones, gastos liquidados) — base legal: interés legítimo en el funcionamiento del producto.',
          'Mostrar tu perfil, spots o itinerarios públicamente si tú activas esa opción — base legal: tu consentimiento explícito, revocable en cualquier momento cambiando la visibilidad.',
        ],
      },
      {
        h: '4. Con quién se comparten tus datos',
        p: [
          'Con los demás miembros de un viaje al que perteneces: ven tu nombre, foto, y el contenido que compartes con ese viaje (documentos, gastos, mensajes, spots).',
          'Con proveedores técnicos que usamos para operar el servicio: almacenamiento de la aplicación y archivos, mapas, y un servicio de traducción automática si usas el traductor. No vendemos tus datos a terceros ni los usamos con fines publicitarios.',
        ],
      },
      {
        h: '5. Cuánto tiempo conservamos tus datos',
        p: [
          'Mientras tu cuenta esté activa. Si borras tu cuenta, tu perfil y tus datos personales se eliminan; el contenido que hayas compartido con un grupo (por ejemplo, un gasto que pagaste) se conserva de forma anonimizada, sin tu email ni tu nombre, para no romper los cálculos del resto del grupo.',
        ],
      },
      {
        h: '6. Tus derechos',
        p: [
          'Tienes derecho a acceder, rectificar, y solicitar la supresión de tus datos, así como a la portabilidad, oposición y limitación del tratamiento, en los términos que marca el RGPD.',
          'Puedes editar tus datos directamente en Ajustes, o borrar tu cuenta por completo desde Ajustes → Borrar cuenta. Para cualquier otra solicitud relacionada con tus datos: hello@kaikodo.app.',
        ],
      },
      {
        h: '7. Seguridad',
        p: [
          'Aplicamos medidas técnicas razonables para proteger tus datos, pero ningún sistema es infalible al 100%. Kaikōdo está en versión beta — recomendamos no subir documentación especialmente sensible salvo la necesaria para planificar tu viaje.',
        ],
      },
      {
        h: '8. Menores de edad',
        p: [
          'Kaikōdo no está dirigido a menores de 16 años. Si crees que un menor ha creado una cuenta sin el consentimiento de sus padres o tutores, contacta con nosotros para eliminarla.',
        ],
      },
      {
        h: '9. Cambios en esta política',
        p: [
          'Si hacemos cambios relevantes en cómo tratamos tus datos, te lo notificaremos dentro de la app.',
        ],
      },
      {
        h: '10. Contacto',
        p: ['Para cualquier duda sobre privacidad: hello@kaikodo.app.'],
      },
    ],
  },
  en: {
    title: 'Privacy policy',
    updated: 'Last updated: July 22, 2026',
    sections: [
      {
        h: '1. Data controller',
        p: ['José Laborda Ubiria, as the controller for Kaikōdo. Contact: hello@kaikodo.app.'],
      },
      {
        h: '2. What data we collect',
        p: [
          'Account data: email, name, username, profile photo.',
          'Trip data: nationality, country and currency of residence, itineraries, documents you upload (tickets, bookings), expenses, trip chat messages, spots (places) you save or recommend.',
          'Technical data: preferred language, and the minimum needed for the service to work (session identifiers).',
        ],
      },
      {
        h: '3. Why we use it and the legal basis',
        p: [
          'To provide the service (build your itinerary, calculate shared expenses, show your documents to whoever you choose) — legal basis: performance of the contract to use the app (GDPR art. 6.1.b).',
          'In-app notifications (invites, settled expenses) — legal basis: legitimate interest in the product working correctly.',
          'Publicly showing your profile, spots, or itineraries if you enable that option — legal basis: your explicit consent, revocable at any time by changing visibility.',
        ],
      },
      {
        h: '4. Who we share your data with',
        p: [
          'With other members of a trip you belong to: they see your name, photo, and the content you share with that trip (documents, expenses, messages, spots).',
          'With technical providers we use to run the service: app and file storage, maps, and an automatic translation service if you use the translator. We do not sell your data to third parties or use it for advertising.',
        ],
      },
      {
        h: '5. How long we keep your data',
        p: [
          'For as long as your account is active. If you delete your account, your profile and personal data are removed; content you shared with a group (for example, an expense you paid) is kept in anonymized form, without your email or name, so it does not break the rest of the group\'s calculations.',
        ],
      },
      {
        h: '6. Your rights',
        p: [
          'You have the right to access, rectify, and request deletion of your data, as well as portability, objection, and restriction of processing, under GDPR.',
          'You can edit your data directly in Settings, or delete your account entirely from Settings → Delete account. For any other data-related request: hello@kaikodo.app.',
        ],
      },
      {
        h: '7. Security',
        p: [
          'We apply reasonable technical measures to protect your data, but no system is 100% foolproof. Kaikōdo is in beta — we recommend not uploading especially sensitive documentation beyond what is needed to plan your trip.',
        ],
      },
      {
        h: '8. Minors',
        p: [
          'Kaikōdo is not intended for anyone under 16. If you believe a minor has created an account without parental or guardian consent, contact us to have it removed.',
        ],
      },
      {
        h: '9. Changes to this policy',
        p: [
          'If we make significant changes to how we handle your data, we will notify you within the app.',
        ],
      },
      {
        h: '10. Contact',
        p: ['For any privacy questions: hello@kaikodo.app.'],
      },
    ],
  },
};

export default function Privacy() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language?.startsWith('en') ? 'en' : 'es';
  const c = CONTENT[lang];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-5 pt-[calc(env(safe-area-inset-top,0px)+3rem)] pb-16">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6 hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
          {lang === 'es' ? 'Volver' : 'Back'}
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