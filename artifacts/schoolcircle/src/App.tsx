import { Switch, Route } from "wouter";
import Board from "./Board";
import Prototype from "./prototype/Prototype";
import AskWidget from "./components/AskWidget";
import QaWidget from "./components/QaWidget";
import LearnApp from "./pages/learn";
import TeachApp from "./pages/teach";
import Landing from "./pages/Landing";
import LoginPage from "./pages/Login";
import AuthGuard from "./auth/AuthGuard";

function ProtectedPrototype() {
  return (
    <AuthGuard>
      <Prototype />
    </AuthGuard>
  );
}

function App() {
  return (
    <>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/login" component={LoginPage} />
        <Route path="/plan" component={Board} />
        <Route path="/prototype" component={ProtectedPrototype} />
        <Route path="/prototype/*" component={ProtectedPrototype} />
        <Route path="/learn" component={LearnApp} />
        <Route path="/learn/*" component={LearnApp} />
        <Route path="/teach" component={TeachApp} />
        <Route path="/teach/*" component={TeachApp} />
        <Route>404 Not Found</Route>
      </Switch>
      <AskWidget />
      <QaWidget />
    </>
  );
}

export default App;
