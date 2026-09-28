import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { FavoritesProvider } from "./context/FavoritesContext";
import { BrandingProvider } from "./context/BrandingContext";
import { ToastProvider } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import { WorkspaceProvider, useWorkspace } from "./context/WorkspaceContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./pages/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import PageLoading from "./components/PageLoading";

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
const WorkspaceOnboarding = lazy(() => import("./pages/WorkspaceOnboarding"));
const TvPlaylistPlayer = lazy(() => import("./pages/TvPlaylistPlayer"));
const NotFound = lazy(() => import("./pages/NotFound"));

function WorkspaceGate() {
  const { currentWorkspace, loading } = useWorkspace();

  if (loading) {
    return <PageLoading />;
  }

  if (!currentWorkspace) {
    return <WorkspaceOnboarding />;
  }

  return (
    <FavoritesProvider>
      <Layout />
    </FavoritesProvider>
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
        <Route
          path="/tv/:workspaceId"
          element={
            <ProtectedRoute>
              <WorkspaceProvider>
                <TvPlaylistPlayer />
              </WorkspaceProvider>
            </ProtectedRoute>
          }
        />
        <Route path="/register" element={<Register />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <WorkspaceProvider>
                <WorkspaceGate />
              </WorkspaceProvider>
            </ProtectedRoute>
          }
        >
          <Route index element={<Home />} />
          <Route path="collection" element={<CollectionHome />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
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
              <BrowserRouter>
                <RoutedContent />
              </BrowserRouter>
            </AuthProvider>
          </ToastProvider>
        </BrandingProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
