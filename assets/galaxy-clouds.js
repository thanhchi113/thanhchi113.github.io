(function () {
    "use strict";

    const controllers = new WeakMap();

    function mount(scene) {
        if (!scene) return null;
        if (controllers.has(scene)) return controllers.get(scene);
        const targetDocument = scene.ownerDocument;
        const targetWindow = targetDocument.defaultView;
        const reducedMotion = targetWindow.matchMedia("(prefers-reduced-motion: reduce)");
        let paused = false;
        let showClouds = true;
        let showGlow = true;
        const canvas = targetDocument.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        canvas.dataset.galaxyClouds = "true";
        canvas.style.cssText = "position:absolute;inset:0;z-index:1;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen";
        scene.appendChild(canvas);
        const context = canvas.getContext("2d");
        if (!context) { canvas.remove(); return null; }
        const texture = document.createElement("canvas");
        const glowTexture = document.createElement("canvas");
        const textureWidth = 1024, textureHeight = 256;
        texture.width = glowTexture.width = textureWidth;
        texture.height = glowTexture.height = textureHeight;
        const textureContext = texture.getContext("2d");
        const glowContext = glowTexture.getContext("2d");
        const image = textureContext.createImageData(textureWidth, textureHeight);
        const glowImage = glowContext.createImageData(textureWidth, textureHeight);

        const clamp = value => Math.max(0, Math.min(1, value));
        function random(x, y) {
            const value = Math.sin(x * 127.1 + y * 311.7 + 43.3) * 43758.5453;
            return value - Math.floor(value);
        }
        function noise(x, y, repeat) {
            const left = Math.floor(x), top = Math.floor(y);
            const dx = x - left, dy = y - top;
            const sx = dx * dx * (3 - 2 * dx), sy = dy * dy * (3 - 2 * dy);
            const a = random((left % repeat + repeat) % repeat, top);
            const b = random(((left + 1) % repeat + repeat) % repeat, top);
            const c = random((left % repeat + repeat) % repeat, top + 1);
            const d = random(((left + 1) % repeat + repeat) % repeat, top + 1);
            return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
        }
        function cloudNoise(x, y) {
            let sum = 0, amplitude = .54, frequency = 1, weight = 0;
            for (let octave = 0; octave < 5; octave++) {
                sum += noise(x * frequency, y * frequency, 8 * frequency) * amplitude;
                weight += amplitude;
                frequency *= 2;
                amplitude *= .52;
            }
            return sum / weight;
        }

        for (let y = 0; y < textureHeight; y++) {
            const ny = y / textureHeight;
            for (let x = 0; x < textureWidth; x++) {
                const nx = x / textureWidth;
                const broad = noise(nx * 8, ny * 3 + 8, 8);
                const details = cloudNoise(nx * 8, ny * 5 + 12);
                const envelope = Math.pow(Math.sin(ny * Math.PI), 2.2);
                const depth = clamp((broad * .65 + details * .8 - .45) * 2.0) * envelope;
                const fibers = clamp((details - .34) * 2.4);
                const alpha = Math.pow(depth, 1.4) * (.56 + fibers * .3);
                const at = (y * textureWidth + x) * 4;
                image.data[at] = 105 + details * 85;
                image.data[at + 1] = 66 + details * 61;
                image.data[at + 2] = 187 + details * 68;
                image.data[at + 3] = Math.round(alpha * 185);
                glowImage.data[at] = 170 + details * 60;
                glowImage.data[at + 1] = 157 + details * 76;
                glowImage.data[at + 2] = 255;
                glowImage.data[at + 3] = Math.round(Math.pow(depth, 1.05) * 220);
            }
        }
        textureContext.putImageData(image, 0, 0);
        glowContext.putImageData(glowImage, 0, 0);

        const pulseTexture = document.createElement("canvas");
        pulseTexture.width = 360;
        pulseTexture.height = 220;
        const pulseContext = pulseTexture.getContext("2d");
        let width = 0, height = 0, animation = 0, elapsed = 0, previous = 0;

        function drawLayer(source, offset, top, layerWidth, layerHeight) {
            for (let x = offset - layerWidth; x < width; x += layerWidth) {
                context.drawImage(source, x, top, layerWidth, layerHeight);
            }
        }
        function paint() {
            context.clearRect(0, 0, width, height);
            if (!showClouds) return;
            const layerWidth = Math.max(width * 1.2, 840);
            const layerHeight = Math.min(height * .58, 510);
            const top = height * .565 - layerHeight * .5;
            const offset = (elapsed * .008) % layerWidth;
            context.globalAlpha = .72;
            drawLayer(texture, offset, top, layerWidth, layerHeight);

            if (showGlow && !reducedMotion.matches) {
                // Slow internal illumination, with no white frame or rapid flashes.
                const cycle = elapsed % 14500;
                const wave = cycle > 1800 && cycle < 4300 ? Math.sin((cycle - 1800) / 2500 * Math.PI) ** 2 : 0;
                const echo = cycle > 5900 && cycle < 9000 ? Math.sin((cycle - 5900) / 3100 * Math.PI) ** 2 * .65 : 0;
                const strength = Math.max(wave, echo) * .43;
                if (strength > .001) {
                    const pulseX = ((layerWidth * .69 + offset) % layerWidth);
                    const pulseY = height * .555;
                    pulseContext.clearRect(0, 0, 360, 220);
                    pulseContext.globalCompositeOperation = "source-over";
                    pulseContext.drawImage(glowTexture, textureWidth * .48, 10, 360, 220, 0, 0, 360, 220);
                    pulseContext.globalCompositeOperation = "destination-in";
                    const mask = pulseContext.createRadialGradient(180, 110, 12, 180, 110, 180);
                    mask.addColorStop(0, "rgba(255,255,255,1)");
                    mask.addColorStop(.35, "rgba(255,255,255,.8)");
                    mask.addColorStop(1, "rgba(255,255,255,0)");
                    pulseContext.fillStyle = mask;
                    pulseContext.fillRect(0, 0, 360, 220);
                    context.globalAlpha = strength;
                    context.drawImage(pulseTexture, pulseX - 220, pulseY - 110, 440, 220);
                }
            }
            context.globalAlpha = 1;
        }
        function loop(now) {
            if (previous) elapsed += Math.min(now - previous, 50);
            previous = now;
            paint();
            animation = targetWindow.requestAnimationFrame(loop);
        }
        function refresh() {
            targetWindow.cancelAnimationFrame(animation);
            animation = 0;
            previous = 0;
            paint();
            if (!paused && !reducedMotion.matches && showClouds && !targetDocument.hidden) {
                animation = targetWindow.requestAnimationFrame(loop);
            }
        }
        function stop() {
            targetWindow.cancelAnimationFrame(animation);
            animation = 0;
            previous = 0;
        }
        function resize() {
            width = targetWindow.innerWidth;
            height = targetWindow.innerHeight;
            const ratio = Math.min(targetWindow.devicePixelRatio || 1, 1.5);
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            paint();
        }
        targetWindow.addEventListener("resize", resize, { passive: true });
        targetDocument.addEventListener("visibilitychange", refresh);
        reducedMotion.addEventListener("change", refresh);
        targetWindow.addEventListener("pagehide", stop);
        targetWindow.addEventListener("pageshow", refresh);
        resize();
        refresh();
        const controller = {
            getState: () => ({ paused: paused || reducedMotion.matches, showClouds, showGlow: showGlow && !reducedMotion.matches }),
            configure(options) {
                if (typeof options.paused === "boolean") paused = options.paused;
                if (typeof options.showClouds === "boolean") showClouds = options.showClouds;
                if (typeof options.showGlow === "boolean") showGlow = options.showGlow;
                refresh();
            },
            destroy() {
                stop();
                targetWindow.removeEventListener("resize", resize);
                targetDocument.removeEventListener("visibilitychange", refresh);
                reducedMotion.removeEventListener("change", refresh);
                targetWindow.removeEventListener("pagehide", stop);
                targetWindow.removeEventListener("pageshow", refresh);
                canvas.remove();
                controllers.delete(scene);
            }
        };
        controllers.set(scene, controller);
        return controller;
    }

    window.GalaxyClouds = Object.freeze({ mount });
    function initialize() {
        document.querySelectorAll(".galaxy-scene").forEach(mount);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
}());
