import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: { game: 'index.html', editor: 'editor.html', character: 'character.html' },
    },
  },
});
