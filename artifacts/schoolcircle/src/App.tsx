import { Switch, Route, Link } from "wouter";
import Board from "./Board";
import Prototype from "./prototype/Prototype";
import AskWidget from "./components/AskWidget";
import QaWidget from "./components/QaWidget";
import LearnApp from "./pages/learn";
import TeachApp from "./pages/teach";

function App() {
  return (
    <>
      <Switch>
        <Route path="/" component={Board} />
        <Route path="/prototype" component={Prototype} />
        <Route path="/prototype/*" component={Prototype} />
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
