# AirAttack — 3D Paranormal Hunt

Juego web 3D donde tenés que rescatar aviones (reales vía OpenSky Network o simulados) atrapados por amenazas paranormales: OVNIs en el Área 51 / Uritorco / Stonehenge, fenómenos del Triángulo de las Bermudas, fosas Marianas, mar de Tasmania, lago Baikal, criaturas como Godzilla en Tokio o el monstruo del Lago Ness, y más.

Hecho con [CesiumJS](https://cesium.com/) + Vite. Sin Unity, sin builds nativos, todo corre en el browser.

## Demo

<https://robotmetropolis.github.io/AirAttack/>

## Cómo correr en local

```bash
npm install
npm run dev
```

Abre <http://localhost:5173>.

## Modos

- **SIM** (default): 80 vuelos generados localmente. No necesita servidor ni API. Es lo que corre en GitHub Pages.
- **LIVE**: vuelos reales de OpenSky Network. Requiere proxy local (`server/proxy.js`) para OAuth2 y 4000 créditos/día. Toggle SIM/LIVE en el HUD.

## Controles

- **Click izquierdo + arrastrar** sobre el globo → rotar como un cubo de Rubik
- **Rueda del mouse** → zoom
- **Click sobre amenaza** → ver ficha
- **Click sobre avión** → ficha + opciones (CINE / SEGUIR / RESCATAR)
- **🎯 Centrar** → recentrar la cámara
- **🔊** → mute / unmute

## Mecánica del juego

1. Las amenazas están activas por defecto y empiezan a "atrapar" aviones que entran a su radio.
2. Cuando un avión queda bajo ataque suena una alarma y aparece un toast.
3. Tenés un tiempo limitado (~30 s) para rescatarlo:
   - Acercando la cámara dentro del radio del avión, **o**
   - Clickeando el avión y apretando **🚨 RESCATAR**.
4. Si se te pasa el tiempo, perdés una vida. Score y vidas se ven en el HUD.

## Deploy a GitHub Pages

Ya está configurado con GitHub Actions (`.github/workflows/deploy.yml`).

1. **Push a `main`** → se buildea y publica solo en `https://<user>.github.io/AirAttack/`.
2. **(Opcional)** En el repo de GitHub: *Settings → Secrets and variables → Actions → New repository secret*  
   `VITE_CESIUM_ION_TOKEN` con tu token de [Cesium Ion](https://ion.cesium.com/) si querés terreno 3D y modelos premium.  
   Sin el token igual funciona, usa OpenStreetMap / Topo / Esri como background.
3. En *Settings → Pages*, dejá la fuente en **GitHub Actions**.

> En GitHub Pages **solo funciona el modo SIM**. El modo LIVE necesita el proxy Node.js de `server/proxy.js` corriendo aparte (Cloudflare Workers / Render / Railway / VPS).

## Stack

- [CesiumJS](https://cesium.com/cesiumjs/) — globo 3D, terreno, entidades
- [Vite](https://vitejs.dev/) — bundler
- [vite-plugin-cesium](https://www.npmjs.com/package/vite-plugin-cesium) — copia de assets de Cesium
- Web Audio API — efectos de sonido sintetizados
- HTML Canvas API — íconos custom para amenazas y aeronaves

## Licencia

MIT
