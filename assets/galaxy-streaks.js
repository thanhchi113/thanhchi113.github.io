(function () {
    "use strict";

    const palette = [[142, 215, 255], [185, 161, 255], [205, 235, 255]];

    function create(width, height) {
        const mobile = width <= 800;
        const count = mobile ? 4 : 7;
        const length = mobile ? Math.min(144, width * .3) : Math.min(250, width * .19);
        const spread = Math.min(340, height * .46);

        return Array.from({ length: count }, (_, index) => ({
            progress: (index + Math.random() * .45) / count,
            offset: ((index + .5) / count - .5) * spread,
            length: length * (.7 + Math.random() * .3),
            speed: .000055 + Math.random() * .000025,
            phase: Math.random() * Math.PI * 2,
            tint: palette[index % palette.length]
        }));
    }

    function draw(context, streaks, time, getFlow) {
        context.save();
        context.globalCompositeOperation = "screen";
        context.lineCap = "round";

        for (const streak of streaks) {
            const flow = getFlow(streak.progress, streak.speed, time, streak.offset);
            const alpha = flow.fade * (.82 + Math.sin(time * .0008 + streak.phase) * .12);
            if (alpha < .015) continue;

            const tailX = flow.x - streak.length;
            const color = streak.tint.join(",");
            const trail = context.createLinearGradient(tailX, flow.y, flow.x, flow.y);
            trail.addColorStop(0, `rgba(${color},0)`);
            trail.addColorStop(.3, `rgba(${color},${alpha * .12})`);
            trail.addColorStop(.72, `rgba(${color},${alpha * .64})`);
            trail.addColorStop(1, `rgba(244,251,255,${alpha})`);

            context.strokeStyle = trail;
            context.shadowColor = `rgba(${color},${alpha * .8})`;
            context.shadowBlur = 14;
            context.beginPath();
            context.moveTo(tailX, flow.y);
            context.lineTo(flow.x, flow.y);
            // A soft colored wake surrounds the sharper white-blue core.
            context.globalAlpha = .23;
            context.lineWidth = 5.5;
            context.stroke();
            context.globalAlpha = 1;
            context.lineWidth = 1.65;
            context.stroke();

            context.shadowBlur = 0;
            const glow = context.createRadialGradient(flow.x, flow.y, 0, flow.x, flow.y, 10);
            glow.addColorStop(0, `rgba(${color},${alpha * .48})`);
            glow.addColorStop(.3, `rgba(${color},${alpha * .15})`);
            glow.addColorStop(1, `rgba(${color},0)`);
            context.fillStyle = glow;
            context.fillRect(flow.x - 10, flow.y - 10, 20, 20);
            context.fillStyle = `rgba(246,252,255,${alpha})`;
            context.beginPath();
            context.arc(flow.x, flow.y, 1.5, 0, Math.PI * 2);
            context.fill();
        }

        context.restore();
    }

    window.GalaxyStreaks = Object.freeze({ create, draw });
}());
