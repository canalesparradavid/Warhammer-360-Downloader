# Warhammer 360 Downloader (extensión de Chrome)

Extensión de Chrome (Manifest V3) que detecta automáticamente las imágenes de la
**vista 360°** del catálogo Warhammer (todas las peticiones de red cuya URL contiene
`/app/resources/catalog/product/threeSixty`), te avisa con un popup y las descarga
en un único archivo **`.zip`** con un solo clic.

## Cómo funciona

1. **Detección** — Un *service worker* escucha con `chrome.webRequest` (solo lectura)
   las peticiones de red de cada pestaña. Cuando una URL contiene
   `/app/resources/catalog/product/threeSixty`, esa imagen se registra (sin duplicados)
   para esa pestaña.
2. **Aviso en la página** — En cuanto se detecta la primera imagen, aparece un
   popup flotante abajo a la derecha de la propia página con el contador y el botón
   **«⬇ Descargar ZIP»**. Se puede plegar (–) o cerrar (×).
3. **Descarga** — Al pulsar el botón (desde el aviso flotante o desde el icono de
   la extensión en la barra de herramientas), la extensión vuelve a descargar todas
   las imágenes detectadas, las comprime en deflate (nativo, sin librerías externas)
   y las guarda como `warhammer-360_<producto>_<fecha>.zip`.

El contador de imágenes también aparece en **rojo sobre el icono** de la extensión
(insignia por pestaña). La lista se limpia automáticamente al navegar a otra página
o al cerrar la pestaña, o manualmente con el botón «Limpiar».

## Instalación

1. Abre `chrome://extensions` en Chrome.
2. Activa el interruptor **«Modo de desarrollador»** (esquina superior derecha).
3. Pulsa **«Cargar descomprimida»** (*Load unpacked*).
4. Selecciona la carpeta `warhammer-360-downloader` (la que contiene el `manifest.json`).
5. (Opcional) Fija el icono en la barra de herramientas con el puzzle 🧩.

## Uso

1. Ve a la web de Warhammer (por ejemplo, la ficha de un producto) y haz clic en la
   vista **360°** del producto.
2. Cuando la página empiece a cargar las imágenes de la vista 360°, verás el aviso
   flotante: *«N imágenes de vista 360° detectadas»*.
3. Pulsa **«⬇ Descargar ZIP»** y elige dónde guardarlo (o desmarca
   «Preguntar dónde guardar» en la ventana de la extensión para guardarlo directamente
   en tu carpeta de Descargas).

También puedes hacer clic en el icono de la extensión en cualquier momento: muestra
miniaturas de las imágenes detectadas, el total y los botones **Descargar ZIP** /
**Limpiar**.

## Archivos

| Archivo | Función |
|---|---|
| `manifest.json` | Manifest V3: permisos, service worker, popup y content script |
| `background.js` | Detección de imágenes, creación del ZIP (deflate nativo) y descarga |
| `content.js` | Popup flotante dentro de la página con el botón de descarga |
| `popup.html` / `popup.css` / `popup.js` | Ventana de la extensión (miniaturas, contador, progreso) |
| `icons/` | Iconos 16/32/48/128 (generados con `scripts/generate-icons.ps1`) |

## Notas y permisos

- **`webRequest` + host `<all_urls>`**: necesarios para *observar* las peticiones de
  red en cualquier web y detectar las imágenes 360° (no se modifica ni se bloquea
  ningún tráfico). Las imágenes se descargan desde el contexto de la extensión.
- **`downloads`**: para guardar el `.zip`.
- **`storage`**: para recordar la preferencia «Preguntar dónde guardar» y mantener
  la lista de imágenes detectadas mientras dura la sesión del navegador.
- El aviso flotante solo aparece cuando se detectan imágenes 360° reales; el resto
  de la web no muestra nada.
- Si el aviso flotante no aparece (por ejemplo, la página lo bloquea), siempre
  puedes usar el icono de la extensión: la detección es independiente del aviso.
- Requiere Chrome 102 o superior.
