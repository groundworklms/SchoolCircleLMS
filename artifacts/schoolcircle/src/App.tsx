import { Switch, Route } from "wouter";
import Board from "./Board";
import Prototype from "./prototype/Prototype";

function App() {
  return (
    <Switch>
      <Route path="/" component={Board} />
      <Route path="/prototype" component={Prototype} />
      <Route path="/prototype/*" component={Prototype} />
      <Route>404 Not Found</Route>
    </Switch>
  );
}

export default App;
