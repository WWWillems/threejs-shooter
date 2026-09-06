import "./characterWorkshop.css";
import { CharacterWorkshopApp } from "./CharacterWorkshopApp";

try {
  new CharacterWorkshopApp(document.getElementById("app") ?? document.body);
} catch (error) {
  const message = error instanceof Error ? error.message : "Could not start the animation workshop";
  document.body.innerHTML = `<pre class="error-screen">${message}</pre>`;
}
