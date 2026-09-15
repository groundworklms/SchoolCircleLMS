import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AuthProvider } from '@/auth/AuthProvider';
import AuthGuard from '@/auth/AuthGuard';
import AskWidget from '@/components/AskWidget';
import QaWidget from '@/components/QaWidget';
import Landing from '@/pages/Landing';
import Login from '@/pages/Login';
import '@/styles/widgets.css';
import '@/styles/widget-fixes.css';
import '@/styles/auth-fixes.css';
// @ts-ignore - migrated JSX modules intentionally remain JavaScript for parity with the source app.
import Board from '@/pages/board';
// @ts-ignore - migrated JSX modules intentionally remain JavaScript for parity with the source app.
import Prototype from './prototype/Prototype';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/login" component={Login} />
        <Route path="/plan" component={Board} />
        <Route path="/prototype"><AuthGuard><Prototype /></AuthGuard></Route>
        <Route path="/prototype/*"><AuthGuard><Prototype /></AuthGuard></Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <AskWidget />
          <QaWidget />
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
