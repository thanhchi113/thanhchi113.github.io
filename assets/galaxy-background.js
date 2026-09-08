// Shared procedural galaxy renderer; preserve the homepage scene on admin pages.
    (function () {
        const canvas = document.getElementById("milkyWayCanvas") || document.getElementById("adminGalaxyCanvas");

        if (!canvas || canvas.dataset.galaxyBackgroundInitialized === "true") return;

        const context = canvas.getContext("2d", { alpha: true });

        if (!context) return;

        const dustTexture = document.createElement("canvas");
        const detailTexture = document.createElement("canvas");
        const starFieldTexture = document.createElement("canvas");
        const dustTextureContext = dustTexture.getContext("2d", { alpha: true });
        const detailTextureContext = detailTexture.getContext("2d", { alpha: true });
        const starFieldTextureContext = starFieldTexture.getContext("2d", { alpha: true });

        if (!context || !dustTextureContext || !detailTextureContext || !starFieldTextureContext) return;

        canvas.dataset.galaxyBackgroundInitialized = "true";

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const palette = [
            [185, 226, 255],
            [137, 194, 255],
            [207, 170, 255],
            [246, 178, 225],
            [255, 247, 235]
        ];

        let width = 0;
        let height = 0;
        let pixelRatio = 1;
        let stars = [];
        let dust = [];
        let streaks = [];
        let frameId = 0;

        function flowY(x, time) {
            const progress = Math.max(0, Math.min(1, x / width));
            const center = width <= 800 ? 0.61 : 0.57;
            const tilt = (progress - 0.5) * height * -0.058;
            const curve = (
                Math.sin(progress * Math.PI * 2.2 + time * 0.00009) * 0.018 +
                Math.sin(progress * Math.PI * 5.1 + time * 0.00005) * 0.007
            ) * height;

            return height * center + tilt + curve;
        }

        function clamp(value, minimum, maximum) {
            return Math.max(minimum, Math.min(maximum, value));
        }

        function smoothstep(value) {
            return value * value * (3 - 2 * value);
        }

        function randomAt(x, y) {
            const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;

            return value - Math.floor(value);
        }

        function valueNoise(x, y) {
            const x0 = Math.floor(x);
            const y0 = Math.floor(y);
            const x1 = x0 + 1;
            const y1 = y0 + 1;
            const tx = smoothstep(x - x0);
            const ty = smoothstep(y - y0);
            const top = randomAt(x0, y0) * (1 - tx) + randomAt(x1, y0) * tx;
            const bottom = randomAt(x0, y1) * (1 - tx) + randomAt(x1, y1) * tx;

            return top * (1 - ty) + bottom * ty;
        }

        function fractalNoise(x, y, octaves) {
            let total = 0;
            let amplitude = 0.56;
            let frequency = 1;
            let normalization = 0;
            const count = octaves || 4;

            for (let octave = 0; octave < count; octave++) {
                total += valueNoise(x * frequency, y * frequency) * amplitude;
                normalization += amplitude;
                amplitude *= 0.52;
                frequency *= 2.04;
            }

            return total / normalization;
        }

        function createScene() {
            const starCount = Math.min(1050, Math.max(520, Math.floor((width * height) / 2600)));
            const dustCount = Math.min(2400, Math.max(1250, Math.floor((width * height) / 520)));

            stars = Array.from({ length: starCount }, function () {
                const tint = palette[Math.floor(Math.random() * palette.length)];
                const x = Math.random() * width;
                const belongsToBand = Math.random() < 0.72;
                const bandOffset = (Math.random() + Math.random() + Math.random() - 1.5) * Math.min(150, height * 0.21);

                return {
                    x: x,
                    y: belongsToBand ? flowY(x, 0) + bandOffset : Math.random() * height,
                    size: Math.random() * 1.16 + 0.14,
                    opacity: Math.random() * 0.4 + 0.1,
                    phase: Math.random() * Math.PI * 2,
                    flare: Math.random() > 0.984,
                    tint: tint
                };
            });

            dust = Array.from({ length: dustCount }, function () {
                const tint = palette[Math.floor(Math.random() * palette.length)];
                const concentration = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

                return {
                    progress: Math.random(),
                    offset: concentration * (42 + Math.random() * Math.min(148, height * 0.19)),
                    size: Math.random() * 1.25 + 0.15,
                    opacity: Math.random() * 0.42 + 0.08,
                    speed: Math.random() * 0.000022 + 0.00002,
                    phase: Math.random() * Math.PI * 2,
                    tint: tint
                };
            });

            streaks = window.GalaxyStreaks.create(width, height);
        }

        function buildStarField() {
            const textureWidth = Math.round(clamp(width * 0.7, 720, 1200));
            const textureHeight = Math.round(clamp(height * 0.7, 430, 760));
            const starCount = Math.min(8500, Math.max(3400, Math.floor((width * height) / 150)));

            starFieldTexture.width = textureWidth;
            starFieldTexture.height = textureHeight;
            starFieldTextureContext.clearRect(0, 0, textureWidth, textureHeight);

            for (let index = 0; index < starCount; index++) {
                const x = Math.random() * textureWidth;
                const sceneX = x / textureWidth * width;
                const belongsToBand = Math.random() < 0.62;
                const spread = (Math.random() + Math.random() + Math.random() - 1.5) * Math.min(180, height * 0.25);
                const y = belongsToBand
                    ? (flowY(sceneX, 0) + spread) / height * textureHeight
                    : Math.random() * textureHeight;

                if (y < 0 || y > textureHeight) continue;

                const tint = palette[Math.floor(Math.random() * palette.length)];
                const bright = Math.random() > 0.973;
                const size = bright ? Math.random() * 1.12 + 0.82 : Math.random() * 0.64 + 0.28;
                const opacity = bright
                    ? Math.random() * 0.42 + 0.42
                    : (Math.random() * 0.36 + 0.17) * (belongsToBand ? 1.18 : 0.78);

                starFieldTextureContext.fillStyle = "rgba(" + tint.join(",") + "," + opacity + ")";

                if (bright) {
                    starFieldTextureContext.beginPath();
                    starFieldTextureContext.arc(x, y, size, 0, Math.PI * 2);
                    starFieldTextureContext.fill();
                } else {
                    starFieldTextureContext.fillRect(x, y, size, size);
                }
            }
        }

        function buildDustTexture() {
            const textureWidth = Math.round(clamp(width * 0.56, 520, 820));
            const textureHeight = Math.round(clamp(height * 0.52, 300, 480));

            dustTexture.width = textureWidth;
            dustTexture.height = textureHeight;
            detailTexture.width = textureWidth;
            detailTexture.height = textureHeight;

            const image = dustTextureContext.createImageData(textureWidth, textureHeight);
            const detailImage = detailTextureContext.createImageData(textureWidth, textureHeight);
            const pixels = image.data;
            const detailPixels = detailImage.data;

            for (let y = 0; y < textureHeight; y++) {
                const normalizedY = y / (textureHeight - 1);

                for (let x = 0; x < textureWidth; x++) {
                    const normalizedX = x / (textureWidth - 1);
                    const macro = fractalNoise(normalizedX * 3.6 + 12, normalizedY * 3.2 + 4, 4);
                    const cloud = fractalNoise(normalizedX * 6.2 + 72, normalizedY * 4.7 + 19, 3);
                    const grain = fractalNoise(normalizedX * 13 + 28, normalizedY * 14 + 17, 3);
                    const fibers = fractalNoise(normalizedX * 22 + 91, normalizedY * 19 + 31, 2);
                    const rose = fractalNoise(normalizedX * 5.7 + 136, normalizedY * 7.5 + 55, 3);
                    const spine = 0.575 - (normalizedX - 0.5) * 0.058 + Math.sin(normalizedX * Math.PI * 2.4) * 0.021;
                    const meander = (macro - 0.5) * 0.052 + Math.sin(normalizedX * 16 + cloud * 5) * 0.012;
                    const distance = normalizedY - (spine + meander);
                    const spread = 0.135 + macro * 0.103 + cloud * 0.022;
                    const envelope = Math.exp(-Math.pow(distance / spread, 2));
                    const darkPath = 0.024 * Math.sin(normalizedX * 10.5 + macro * 5.2) + 0.014 * Math.sin(normalizedX * 23 + grain * 8);
                    const laneA = Math.exp(-Math.pow((distance - darkPath) / 0.015, 2));
                    const laneB = Math.exp(-Math.pow((distance + 0.054 + darkPath * 0.56) / 0.022, 2));
                    const laneC = Math.exp(-Math.pow((distance - 0.076 - darkPath * 0.33) / 0.036, 2));
                    const fragmentation = fractalNoise(normalizedX * 9 + 51, normalizedY * 6 + 23, 3);
                    const darkKnot = clamp((fragmentation - 0.22) * 1.28, 0, 1);
                    const darkDust = laneA * (0.14 + darkKnot * 0.84) + laneB * (0.1 + darkKnot * 0.7) + laneC * (0.04 + fibers * 0.3);
                    const cloudPatch = clamp((macro - 0.3) * 1.45 + (cloud - 0.34) * 0.95, 0, 1);
                    const density = clamp(envelope * (0.18 + macro * 0.5 + cloud * 0.3 + grain * 0.24) * (0.5 + cloudPatch * 0.68) * (1 - darkDust * 0.94), 0, 1);
                    const index = (y * textureWidth + x) * 4;

                    if (density < 0.012) {
                        pixels[index + 3] = 0;
                        continue;
                    }

                    const clump = clamp((macro + cloud - 0.9) * 1.65, 0, 1);
                    const blue = clamp(0.38 + macro * 0.47 + cloud * 0.12, 0, 1);
                    const violet = clamp((grain - 0.12) * 1.28 + clump * 0.28, 0, 1);
                    const pink = clamp((cloudPatch - 0.32) * 0.84 + (rose - 0.58) * 1.38 + Math.sin(normalizedX * 9) * 0.07, 0, 1);
                    const brightness = 0.58 + density * 0.6 + clump * 0.11;

                    pixels[index] = Math.round((36 + violet * 126 + pink * 164 + clump * 18) * brightness);
                    pixels[index + 1] = Math.round((72 + blue * 104 + pink * 43 + clump * 20) * brightness);
                    pixels[index + 2] = Math.round((145 + blue * 82 + violet * 86 + pink * 12) * brightness);
                    pixels[index + 3] = Math.round(Math.pow(density, 0.78) * 242);

                    const detailDensity = clamp(envelope * (0.13 + grain * 0.65 + fibers * 0.34) * (0.4 + clump * 0.72) * (1 - darkDust * 0.94), 0, 1);

                    if (detailDensity > 0.035) {
                        const detailBrightness = 0.5 + detailDensity * 0.68;

                        detailPixels[index] = Math.round((64 + violet * 145 + pink * 174) * detailBrightness);
                        detailPixels[index + 1] = Math.round((76 + blue * 102 + pink * 48) * detailBrightness);
                        detailPixels[index + 2] = Math.round((156 + blue * 72 + violet * 82 + pink * 14) * detailBrightness);
                        detailPixels[index + 3] = Math.round(Math.pow(detailDensity, 1.3) * 172);
                    }

                    const stardust = randomAt(x * 2.17 + 191, y * 3.11 + 47);
                    const starChance = clamp((density - 0.15) * 1.7, 0, 1) * 0.015;

                    if (stardust > 1 - starChance) {
                        const glint = clamp((stardust - (1 - starChance)) / Math.max(starChance, 0.001), 0, 1);

                        detailPixels[index] = Math.max(detailPixels[index], Math.round(164 + glint * 76));
                        detailPixels[index + 1] = Math.max(detailPixels[index + 1], Math.round(186 + glint * 58));
                        detailPixels[index + 2] = Math.max(detailPixels[index + 2], Math.round(226 + glint * 29));
                        detailPixels[index + 3] = Math.max(detailPixels[index + 3], Math.round(118 + glint * 112));
                    }
                }
            }

            dustTextureContext.putImageData(image, 0, 0);
            detailTextureContext.putImageData(detailImage, 0, 0);
        }

        function resize() {
            pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
            width = window.innerWidth;
            height = window.innerHeight;

            canvas.width = Math.round(width * pixelRatio);
            canvas.height = Math.round(height * pixelRatio);
            canvas.style.width = width + "px";
            canvas.style.height = height + "px";
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

            createScene();
            buildDustTexture();
            buildStarField();
            paint(performance.now());
        }

        function drawMilkyWay(time) {
            const driftX = Math.sin(time * 0.00021) * 17;
            const driftY = Math.cos(time * 0.00016) * 9;
            const detailDriftX = Math.sin(time * 0.00032 + 0.85) * 32;
            const detailDriftY = Math.cos(time * 0.00023 + 1.3) * 14;

            context.save();
            context.globalAlpha = 0.93;
            context.filter = "blur(0.45px)";
            context.drawImage(dustTexture, driftX - 18, driftY - 12, width + 36, height + 24);
            context.globalAlpha = 0.64;
            context.filter = "blur(0.1px)";
            context.drawImage(detailTexture, detailDriftX - 36, detailDriftY - 22, width + 72, height + 44);
            context.restore();
        }

        function drawStarField() {
            context.save();
            context.globalAlpha = 0.8;
            context.drawImage(starFieldTexture, 0, 0, width, height);
            context.restore();
        }

        function getHorizontalFlow(progress, speed, time, offset) {
            const cycle = (progress + time * speed) % 1;
            const x = -90 + (width + 180) * cycle;
            const edge = Math.min(1, cycle * 8, (1 - cycle) * 8);
            const y = flowY(clamp(x, 0, width), time) + offset + Math.sin(time * 0.00065 + progress * 17) * 1.8;

            return {
                x: x,
                y: y,
                direction: 1,
                fade: Math.pow(Math.max(0, edge), 0.62),
                eased: cycle
            };
        }

        function drawStreaks(time) {
            window.GalaxyStreaks.draw(context, streaks, time, getHorizontalFlow);
        }

        function paint(time) {
            context.clearRect(0, 0, width, height);
            context.save();
            context.globalCompositeOperation = "screen";

            drawStarField();
            drawMilkyWay(time);

            for (const star of stars) {
                const twinkle = star.opacity * (0.72 + Math.sin(time * 0.001 + star.phase) * 0.28);
                const color = star.tint.join(",");

                context.fillStyle = "rgba(" + color + "," + Math.max(0.05, twinkle) + ")";
                context.fillRect(star.x, star.y, star.size, star.size);

                if (star.flare && twinkle > 0.3) {
                    const flareSize = star.size * 4.5;

                    context.strokeStyle = "rgba(234, 248, 255," + (twinkle * 0.42) + ")";
                    context.lineWidth = 0.55;
                    context.beginPath();
                    context.moveTo(star.x - flareSize, star.y);
                    context.lineTo(star.x + flareSize, star.y);
                    context.moveTo(star.x, star.y - flareSize);
                    context.lineTo(star.x, star.y + flareSize);
                    context.stroke();
                }
            }

            for (const particle of dust) {
                const flow = getHorizontalFlow(particle.progress, particle.speed, time, particle.offset);
                const shimmer = particle.opacity * (0.72 + Math.sin(time * 0.0014 + particle.phase) * 0.28) * flow.fade;

                context.fillStyle = "rgba(" + particle.tint.join(",") + "," + Math.max(0.03, shimmer) + ")";
                context.beginPath();
                context.arc(flow.x, flow.y, particle.size * (0.76 + flow.eased * 0.34), 0, Math.PI * 2);
                context.fill();
            }

            drawStreaks(time);

            context.restore();
        }

        function animate(time) {
            paint(time);

            if (!reducedMotion.matches && !document.hidden) {
                frameId = requestAnimationFrame(animate);
            }
        }

        function refreshMotion() {
            cancelAnimationFrame(frameId);
            paint(performance.now());

            if (!reducedMotion.matches && !document.hidden) {
                frameId = requestAnimationFrame(animate);
            }
        }

        window.addEventListener("resize", resize, { passive: true });
        document.addEventListener("visibilitychange", refreshMotion, { passive: true });
        reducedMotion.addEventListener("change", refreshMotion);

        resize();
        refreshMotion();
    }());
