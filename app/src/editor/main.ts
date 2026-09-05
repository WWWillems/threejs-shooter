import "./editor.css";
import { EditorApp } from "./EditorApp";

try {
  new EditorApp(document.getElementById("app") ?? document.body);
} catch (error) {
  const message = error instanceof Error ? error.message : "Could not start level editor";
  document.body.innerHTML = `<pre class="error-screen">${message}</pre>`;
}
