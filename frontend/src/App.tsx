import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Outlet, useLocation } from "react-router-dom";
import { AccessProvider, useAccess } from "./context/AccessContext";
import { AuthProvider } from "./context/AuthContext";
import { FavoritesProvider } from "./context/FavoritesContext";
import { BrandingProvider } from "./context/BrandingContext";
import { ChatProvider } from "./context/ChatContext";
import { ToastProvider } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import { WorkspaceProvider, useWorkspace } from "./context/WorkspaceContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./pages/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import PageLoading from "./components/PageLoading";
import { useAnalyticsAccess } from "./hooks/useAnalyticsAccess";

// Cada rota carrega seu proprio chunk sob demanda -- sem isso, a tela de login (a primeira
// coisa que qualquer um ve) baixava o mesmo bundle gigante que inclui Configuracoes, o player
// de TV e o SDK inteiro do powerbi-client (usado so dentro de CollectionHome), mesmo sem
// nunca precisar de nada disso.
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Home = lazy(() => import("./pages/Home"));
const CollectionHome = lazy(() => import("./pages/CollectionHome"));
const Settings = lazy(() => import("./pages/Settings"));
const ManageUsers = lazy(() => import("./pages/ManageUsers"));
const Collections = lazy(() => import("./pages/Collections"));
const Subscriptions = lazy(() => import("./pages/Subscriptions"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Catalog = lazy(() => import("./pages/Catalog"));
const Account = lazy(() => import("./pages/Account"));
const Audit = lazy(() => import("./pages/Audit"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const WorkspaceOnboarding = lazy(() => import("./pages/WorkspaceOnboarding"));
const AnalyticsOnly = lazy(() => import("./pages/AnalyticsOnly"));
const Tvs = lazy(() => import("./pages/Tvs"));
const TvEditor = lazy(() => import("./pages/TvEditor"));
const TvPlayer = lazy(() => import("./pages/TvPlayer"));
const ReportFullscreen = lazy(() => import("./pages/ReportFullscreen"));
const NotFound = lazy(() => import("./pages/NotFound"));

function WorkspaceGate() {
  const { currentWorkspace, loading } = useWorkspace();
  const access = useAccess();
  const analytics = useAnalyticsAccess();

  if (loading || (!currentWorkspace && (analytics.loading || access.loading))) {
    return <PageLoading />;
  }

  if (!currentWorkspace) {
    // Quem pode ver os analiticos ou o log geral, mas nao tem colecao nem pode criar uma, nao precisa de colecao para usar o painel
    if ((analytics.canView || access.can("auditoria.ver")) && !access.can("colecao.criar")) return <AnalyticsOnly />;
    return <WorkspaceOnboarding />;
  }

  return (
    <FavoritesProvider>
      <Layout />
    </FavoritesProvider>
  );
}

/** Rotas logadas que podem mostrar o painel do chat (o app e o relatorio em tela cheia). O provedor do chat
 * fica aqui, acima das duas, para a conversa e o painel aberto continuarem ao entrar e sair de um relatorio.
 * Sair da conta desmonta tudo: a proxima pessoa nao ve a conversa. */
function ChatShell() {
  return (
    <ProtectedRoute>
      <ChatProvider>
        <Outlet />
      </ChatProvider>
    </ProtectedRoute>
  );
}

/** Reseta o ErrorBoundary a cada troca de rota -- sem isso, um erro passageiro numa tela
 * deixava o app inteiro travado mesmo depois de navegar pra outro lugar sem problema. */
function RoutedContent() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* A pagina da propria TV: fora do login e dos provedores de pessoa, o acesso e o link secreto mais o codigo */}
        <Route path="/tv/p/:secret" element={<TvPlayer />} />
        <Route path="/register" element={<Register />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<ChatShell />}>
          <Route
            path="/collection/:workspaceId/report/:reportId"
            element={
              <WorkspaceProvider>
                <ReportFullscreen />
              </WorkspaceProvider>
            }
          />
          <Route
            path="/"
            element={
              <WorkspaceProvider>
                <WorkspaceGate />
              </WorkspaceProvider>
            }
          >
            <Route index element={<Home />} />
            <Route path="collection" element={<CollectionHome />} />
            <Route path="settings" element={<Settings />} />
            <Route path="collections" element={<Collections />} />
            <Route path="subscriptions" element={<Subscriptions />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="catalog" element={<Catalog />} />
            <Route path="tv" element={<Tvs />} />
            <Route path="tv/:tvId" element={<TvEditor />} />
            <Route path="users" element={<ManageUsers />} />
            <Route path="account" element={<Account />} />
            <Route path="audit" element={<Audit />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    // Rede de seguranca pra erro fora do Router (raro); o ErrorBoundary que realmente
    // importa no dia a dia e o de dentro de RoutedContent, que reseta a cada troca de rota.
    <ErrorBoundary>
      <ThemeProvider>
        <BrandingProvider>
          <ToastProvider>
            <AuthProvider>
              <AccessProvider>
                <BrowserRouter>
                  <RoutedContent />
                </BrowserRouter>
              </AccessProvider>
            </AuthProvider>
          </ToastProvider>
        </BrandingProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
