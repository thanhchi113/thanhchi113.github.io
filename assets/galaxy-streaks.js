(function () {
    "use strict";

    const fallbackPalette = [[142, 215, 255], [185, 161, 255], [205, 235, 255], [255, 214, 153]];

    function parseRgb(raw, fallback) {
        const text = String(raw || "").trim();
        if (!text) return fallback;
        if (text.startsWith("#")) {
            const hex = text.slice(1);
            if (hex.length === 3) {
                return [
                    parseInt(hex[0] + hex[0], 16),
                    parseInt(hex[1] + hex[1], 16),
                    parseInt(hex[2] + hex[2], 16)
                ];
            }
            if (hex.length >= 6) {
                return [
                    parseInt(hex.slice(0, 2), 16),
                    parseInt(hex.slice(2, 4), 16),
                    parseInt(hex.slice(4, 6), 16)
                ];
            }
        }
        const match = text.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
        return fallback;
    }

    function getThemePalette() {
        const style = getComputedStyle(document.documentElement);
        return [
            parseRgb(style.getPropertyValue("--theme-accent"), fallbackPalette[0]),
            parseRgb(style.getPropertyValue("--theme-accent-2"), fallbackPalette[1]),
            parseRgb(style.getPropertyValue("--theme-accent-3"), fallbackPalette[2]),
            parseRgb(style.getPropertyValue("--theme-highlight"), fallbackPalette[3])
        ];
    }

    function create(width, height) {
        const mobile = width <= 800;
        const count = mobile ? 4 : 7;
        const length = mobile ? Math.min(144, width * .3) : Math.min(250, width * .19);
        const spread = Math.min(340, height * .46);
        const palette = getThemePalette();

        return Array.from({ length: count }, (_, index) => ({
            progress: (index + Math.random() * .45) / count,
            offset: ((index + .5) / count - .5) * spread,
            length: length * (.7 + Math.random() * .3),
            speed: .000055 + Math.random() * .000025,
            phase: Math.random() * Math.PI * 2,
            tintIndex: index % palette.length,
            tint: palette[index % palette.length]
        }));
    }

    function draw(context, streaks, time, getFlow) {
        const activePalette = getThemePalette();
        const highlight = activePalette[3] || fallbackPalette[3];
        const tipColor = [
            Math.round((highlight[0] + 255) * 0.5),
            Math.round((highlight[1] + 255) * 0.5),
            Math.round((highlight[2] + 255) * 0.5)
        ].join(",");

        context.save();
        context.globalCompositeOperation = "screen";
        context.lineCap = "round";

        for (const streak of streaks) {
            const flow = getFlow(streak.progress, streak.speed, time, streak.offset);
            const alpha = flow.fade * (.82 + Math.sin(time * .0008 + streak.phase) * .12);
            if (alpha < .015) continue;

            const tailX = flow.x - streak.length;
            const tint = activePalette[(streak.tintIndex ?? 0) % activePalette.length] || streak.tint;
            const color = tint.join(",");
            const trail = context.createLinearGradient(tailX, flow.y, flow.x, flow.y);
            trail.addColorStop(0, `rgba(${color},0)`);
            trail.addColorStop(.3, `rgba(${color},${alpha * .16})`);
            trail.addColorStop(.72, `rgba(${color},${alpha * .72})`);
            trail.addColorStop(1, `rgba(${tipColor},${alpha})`);

            context.strokeStyle = trail;
            context.shadowColor = `rgba(${color},${alpha * .88})`;
            context.shadowBlur = 14;
            context.beginPath();
            context.moveTo(tailX, flow.y);
            context.lineTo(flow.x, flow.y);
            // A soft theme-colored wake surrounds the bright core.
            context.globalAlpha = .28;
            context.lineWidth = 5.5;
            context.stroke();
            context.globalAlpha = 1;
            context.lineWidth = 1.65;
            context.stroke();

            context.shadowBlur = 0;
            const glow = context.createRadialGradient(flow.x, flow.y, 0, flow.x, flow.y, 10);
            glow.addColorStop(0, `rgba(${color},${alpha * .54})`);
            glow.addColorStop(.3, `rgba(${color},${alpha * .18})`);
            glow.addColorStop(1, `rgba(${color},0)`);
            context.fillStyle = glow;
            context.fillRect(flow.x - 10, flow.y - 10, 20, 20);
            context.fillStyle = `rgba(${tipColor},${alpha})`;
            context.beginPath();
            context.arc(flow.x, flow.y, 1.5, 0, Math.PI * 2);
            context.fill();
        }

        context.restore();
    }

    window.GalaxyStreaks = Object.freeze({ create, draw });
}());
