import { Toaster } from "@/components/ui/toaster"
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { queryClientInstance, persistOptions } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import LoginScreen from '@/components/auth/LoginScreen';
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import TripsList from './pages/TripsList';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import { I18nextProvider, useTranslation } from 'react-i18next';
import i18n from '@/i18n/index.js';

const { Pages, Layout } = pagesConfig;
const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  // Fix (ago 2026) -- "tras registrarme/entrar la app se queda colgada,
    // hay que cerrar y volver a abrirla": este componente llevaba su PROPIA
    // copia del usuario (authUser/userLoaded) en vez de usar directamente
    // `user` de useAuth(), reobteniéndola con su propio base44.auth.me() en
    // un useEffect aparte. Tras un login/registro, checkAppState() (llamado
    // como onSuccess de LoginScreen) dispara varias veces seguidas el mismo
    // ciclo isLoadingAuth/authError mientras resuelve -- y cada vez, este
    // efecto lanzaba OTRA llamada a auth.me() en paralelo (hasta 3-4 por un
    // solo login), aparte de la que ya hace checkUserAuth() en AuthContext.
    // Peor aún: `userLoaded` se ponía a true la PRIMERA vez (como visitante
    // anónimo, antes de loguearse) y nunca se reseteaba a false en el
    // siguiente login -- así que en cuanto isLoadingAuth/isLoadingPublicSettings
    // volvían a false tras el login, la puerta de carga se abría usando el
    // `authUser` todavía viejo (null) mientras alguna de esas llamadas
    // redundantes seguía en vuelo, en vez de esperar a los datos nuevos. En
    // un móvil con red de viaje (lenta o con el backend de Render en frío)
    // esto se sentía como que la app se quedaba colgada -- solo un cierre y
    // reapertura completo (que reinicia todo este estado desde cero, con una
    // sola llamada) lo desatascaba. Al usar `user` de useAuth() directamente
    // no hay ninguna copia ni llamada duplicada que pueda ir por detrás.
  const { user: authUser, isLoadingAuth, isLoadingPublicSettings, authError, checkAppState } = useAuth();
    const { t } = useTranslation();
    const location = useLocation();

    // #3: el email de "restablecer contraseña" (base44.auth.resetPasswordRequest,
    // ver LoginScreen.jsx) enlaza a una página propia para poner la contraseña
    // nueva -- pero ForgotPassword.jsx/ResetPassword.jsx (en src/pages/) nunca
    // llegaban a montarse: ni estaban registradas en pages.config.js, ni
    // habrían sido alcanzables aunque lo estuvieran, porque <Routes> de más
    // abajo solo se monta DESPUÉS de resolver el estado de auth, y un usuario
    // sin sesión (el caso normal al tocar un link de "olvidé mi contraseña")
    // cae siempre en la rama authError.type==='auth_required' de aquí abajo,
    // que muestra LoginScreen sin mirar la URL. Se comprueba la ruta aquí, lo
    // primero de todo, para que estas dos páginas públicas se monten pase lo
    // que pase con el login -- se aceptan ambas grafías (kebab-case y el
    // PascalCase que usa el resto de páginas) porque no hay forma de
    // verificar aquí cuál usa realmente la plantilla de email de base44 sin
    // disparar un envío real.
  // Migración silenciosa: mantener UserProfile.email en minúsculas y al día.
  useEffect(() => {
    if (!authUser?.id || !authUser?.email) return;
    const correctEmail = authUser.email.toLowerCase();
    base44.entities.UserProfile.filter({ user_id: authUser.id }).then(results => {
      const prof = results?.[0];
      // invites.js/NotificationBell/Invites.jsx siempre comparan y filtran
      // email en minúsculas — antes esto solo corregía perfiles SIN email
      // (`!prof.email`), pero un perfil que ya tuviera el email guardado con
      // mayúsculas (p. ej. backfileado antes de este fix, o si el proveedor
      // de auth lo cambia) se quedaba mal para siempre: la condición nunca
      // volvía a cumplirse. Se corrige cualquier desajuste, no solo el vacío.
      if (prof && prof.email !== correctEmail) {
        base44.entities.UserProfile.update(prof.id, { email: correctEmail }).catch(() => {});
      }
    }).catch(() => {});
  }, [authUser?.id, authUser?.email]);

    // #3: el email de "restablecer contraseña" (base44.auth.resetPasswordRequest,
    // ver LoginScreen.jsx) enlaza a una página propia para poner la contraseña
    // nueva -- pero ForgotPassword.jsx/ResetPassword.jsx (en src/pages/) nunca
    // llegaban a montarse: ni estaban registradas en pages.config.js, ni
    // habrían sido alcanzables aunque lo estuvieran, porque <Routes> de más
    // abajo solo se monta DESPUÉS de resolver el estado de auth, y un usuario
    // sin sesión (el caso normal al tocar un link de "olvidé mi contraseña")
    // cae siempre en la rama authError.type==='auth_required' de aquí abajo,
    // que muestra LoginScreen sin mirar la URL. Se comprueba la ruta aquí,
    // lo primero de todo, para que estas dos páginas públicas se monten pase lo
    // que pase con el login -- se aceptan ambas grafías (kebab-case y el
    // PascalCase que usa el resto de páginas) porque no hay forma de
    // verificar aquí cuál usa realmente la plantilla de email de base44 sin
    // disparar un envío real.
    const path = location.pathname.toLowerCase();
    if (path === '/forgot-password' || path === '/forgotpassword') {
      return <ForgotPassword />;
    }
    if (path === '/reset-password' || path === '/resetpassword') {
      return <ResetPassword />;
    }

    if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError && authError.type === 'offline' && authUser) {
    // #14: hay usuario en caché (ver handleOfflineOrError en AuthContext.jsx)
    // pese al fallo de red -- se deja caer al <Routes> de abajo en vez de
    // bloquear, para que las pantallas rendericen con lo que haya en el
    // cache de react-query (persistido en localStorage, ver query-client.js).
    // OfflineIndicator (dentro de Layout, montado por <Routes>) es quien
    // avisa al usuario de que está sin conexión -- no hace falta duplicar
    // ese aviso aquí.
  } else if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Antes esto llamaba a navigateToLogin() (via un useEffect) para SACAR
      // al usuario de la app hacia la pantalla /login hospedada por base44
      // (flujo "Pública, inicio de sesión requerido" -- ahora marcado como
      // obsoleto en el propio panel de base44). Con el flujo nuevo ("Pública,
      // sin inicio de sesión") la app siempre carga y es el propio código
      // quien decide cuándo mostrar login -- así que ahora montamos nuestra
      // propia pantalla (ver src/components/auth/LoginScreen.jsx) en vez de
      // navegar a ningún sitio. checkAppState() (ya expuesto por
      // useAuth()) es lo que hace que, tras un login/registro con éxito, la
      // app vuelva a comprobar el estado de auth y monte el resto con
      // normalidad.
      return <LoginScreen onSuccess={checkAppState} />;
    } else {
      // Antes, cualquier authError.type no contemplado explícitamente arriba
      // (p. ej. 'unknown', o el nuevo 'network_error' que ahora fija
      // checkUserAuth ante un fallo sin conexión) no tenía ningún return: el
      // flujo seguía hacia abajo y terminaba renderizando <Routes> como si
      // todo estuviera bien, con el usuario sin autenticar del todo — justo
      // el síntoma de "pantallas vacías o rotas sin aviso" que motivó los
      // fixes de auth de rondas anteriores, reaparecido para este camino.
      return (
        <div className="fixed inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center">
            <p className="text-foreground font-medium mb-2">{t('common.error')}</p>
            <p className="text-muted-foreground text-sm mb-6">{authError.message || t('common.tryAgain')}</p>
            <button
              onClick={() => checkAppState()}
              className="px-5 py-2.5 rounded-full bg-primary text-white text-sm font-medium"
            >
              {t('common.tryAgain')}
            </button>
          </div>
        </div>
      );
    }
  }

  // Gate: Email not verified (VerifyEmail is in pagesConfig, but we intercept here for auth flow)
  if (authUser && authUser.is_verified === false) {
    const VerifyEmailPage = Pages['VerifyEmail'];
    return VerifyEmailPage ? <VerifyEmailPage /> : null;
  }

  return (
    <Routes>
      <Route path="/" element={<LayoutWrapper currentPageName="TripsList"><TripsList /></LayoutWrapper>} />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    if (i18n.isInitialized) {
      setI18nReady(true);
    } else {
      i18n.on('initialized', () => setI18nReady(true));
    }
  }, []);

  // El modo oscuro (useDarkMode, en components/hooks/useDarkMode.jsx) solo
  // aplica la clase "dark" al <html> mientras <DarkModeToggle> está montado,
  // y ese componente solo vive dentro de Settings.jsx. Resultado: activar
  // "Modo oscuro" ahí lo mostraba oscuro SOLO en esa pantalla — en cualquier
  // otra página (Home, Ruta, Gastos...) o tras recargar, la preferencia
  // guardada en localStorage nunca se leía, así que todo volvía a claro.
  // Aplicamos la preferencia guardada aquí, en el nodo raíz siempre montado,
  // para que se respete en toda la app desde el primer render.
  useEffect(() => {
    try {
      const stored = localStorage.getItem('darkMode');
      const isDark = stored ? JSON.parse(stored) : false;
      window.document.documentElement.classList.toggle('dark', !!isDark);
    } catch {
      // localStorage inaccesible (modo privado, etc.) — se queda en claro.
    }
  }, []);

  if (!i18nReady) return null;

  return (
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <PersistQueryClientProvider client={queryClientInstance} persistOptions={persistOptions}>
          <Router>
            <NavigationTracker />
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </PersistQueryClientProvider>
      </AuthProvider>
    </I18nextProvider>
  )
}

export default App