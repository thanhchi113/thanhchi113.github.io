(() => {
    "use strict";

    let dialog;
    let content;
    let previousButton;
    let nextButton;
    let closeButton;
    let counter;
    let title;
    let session = null;

    const makeElement = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text) element.textContent = text;
        return element;
    };

    function makeButton(id, label, symbol) {
        const button = makeElement("button", "achievement-gallery-button");
        button.id = id;
        button.type = "button";
        button.setAttribute("aria-label", label);
        button.title = label;
        const icon = makeElement("span", "", symbol);
        icon.setAttribute("aria-hidden", "true");
        button.append(icon);
        return button;
    }

    function createDialog() {
        if (dialog) return;
        dialog = makeElement("div", "achievement-gallery");
        dialog.id = "achievementGallery";
        dialog.hidden = true;
        dialog.tabIndex = -1;
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "achievementGalleryTitle");

        const toolbar = makeElement("div", "achievement-gallery-toolbar");
        title = makeElement("h2", "achievement-gallery-title", "Thành tích học sinh");
        title.id = "achievementGalleryTitle";
        counter = makeElement("span", "achievement-gallery-count");
        counter.id = "achievementGalleryCount";
        counter.setAttribute("role", "status");
        counter.setAttribute("aria-live", "polite");
        counter.setAttribute("aria-atomic", "true");
        closeButton = makeButton("achievementGalleryClose", "Đóng xem card (Esc)", "×");
        toolbar.append(title, counter, closeButton);

        const stage = makeElement("div", "achievement-gallery-stage");
        content = makeElement("div", "achievement-gallery-content");
        content.id = "achievementGalleryContent";
        content.tabIndex = -1;
        stage.append(content);
        previousButton = makeButton("achievementGalleryPrev", "Card trước (←)", "‹");
        nextButton = makeButton("achievementGalleryNext", "Card tiếp theo (→)", "›");
        previousButton.setAttribute("aria-controls", content.id);
        nextButton.setAttribute("aria-controls", content.id);
        dialog.append(toolbar, previousButton, stage, nextButton);
        document.body.append(dialog);

        closeButton.addEventListener("click", close);
        previousButton.addEventListener("click", () => navigate(-1));
        nextButton.addEventListener("click", () => navigate(1));
        dialog.addEventListener("click", event => {
            if (event.target === dialog) close();
        });
        document.addEventListener("keydown", handleKeydown, true);
        document.addEventListener("focusin", event => {
            if (session && !dialog.contains(event.target)) closeButton.focus({ preventScroll: true });
        });
    }

    function rememberStyle(element, property) {
        return {
            element,
            property,
            value: element.style.getPropertyValue(property),
            priority: element.style.getPropertyPriority(property)
        };
    }

    function restoreStyle(saved) {
        if (saved.value) saved.element.style.setProperty(saved.property, saved.value, saved.priority);
        else saved.element.style.removeProperty(saved.property);
    }

    function renderCurrent() {
        const state = session;
        if (!state) return;
        const wasFocusedInsideCard = content.contains(document.activeElement);
        let card;
        try {
            card = state.render(state.items[state.index], state.index);
            if (!(card instanceof Element)) throw new TypeError("Card renderer must return an Element");
        } catch (error) {
            console.error("Không thể hiển thị card thành tích:", error);
            card = makeElement("p", "achievement-gallery-error", "Không thể hiển thị card này. Bạn có thể chuyển sang card khác hoặc đóng để thử lại.");
        }
        card.classList.add("achievement-gallery-card");
        content.replaceChildren(card);
        content.parentElement.scrollTop = 0;
        counter.textContent = `${state.index + 1} / ${state.items.length}`;
        counter.setAttribute("aria-label", `Card ${state.index + 1} trên ${state.items.length}`);
        previousButton.disabled = state.index === 0;
        nextButton.disabled = state.index === state.items.length - 1;
        if (wasFocusedInsideCard) content.focus({ preventScroll: true });
        if (document.activeElement === previousButton && previousButton.disabled) nextButton.focus({ preventScroll: true });
        if (document.activeElement === nextButton && nextButton.disabled) previousButton.focus({ preventScroll: true });
    }

    function navigate(direction) {
        if (!session) return;
        const nextIndex = session.index + direction;
        if (nextIndex < 0 || nextIndex >= session.items.length) return;
        session.index = nextIndex;
        renderCurrent();
    }

    function focusableElements() {
        return [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter(element => !element.disabled && !element.closest("[hidden], [inert]") && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
    }

    function handleKeydown(event) {
        if (!session) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key === "Tab") {
            const nodes = focusableElements();
            const activeIndex = nodes.indexOf(document.activeElement);
            if (!nodes.length) {
                event.preventDefault();
                dialog.focus();
            } else if (event.shiftKey && activeIndex <= 0) {
                event.preventDefault();
                nodes[nodes.length - 1].focus();
            } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === nodes.length - 1)) {
                event.preventDefault();
                nodes[0].focus();
            }
            return;
        }
        const editing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']");
        if (!editing && !event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            event.stopPropagation();
            navigate(event.key === "ArrowLeft" ? -1 : 1);
        }
    }

    function open(options) {
        if (!options || !Array.isArray(options.items) || !options.items.length || typeof options.render !== "function") return false;
        createDialog();
        if (session) close();
        const requestedIndex = Number.isInteger(options.index) ? options.index : 0;
        session = {
            items: options.items.slice(),
            index: Math.max(0, Math.min(requestedIndex, options.items.length - 1)),
            render: options.render,
            trigger: options.trigger instanceof HTMLElement ? options.trigger : document.activeElement,
            priorFocus: document.activeElement,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            hadBodyClass: document.body.classList.contains("achievement-gallery-open"),
            styles: [rememberStyle(document.body, "overflow"), rememberStyle(document.documentElement, "overflow")],
            inertElements: []
        };
        title.textContent = options.label || "Thành tích học sinh";
        document.body.classList.add("achievement-gallery-open");
        document.body.style.setProperty("overflow", "hidden", "important");
        document.documentElement.style.setProperty("overflow", "hidden", "important");
        dialog.hidden = false;
        renderCurrent();
        closeButton.focus({ preventScroll: true });
        for (const element of document.body.children) {
            if (element === dialog || element.matches("script, style, link, .site-galaxy")) continue;
            session.inertElements.push({ element, value: element.getAttribute("inert") });
            element.setAttribute("inert", "");
        }
        return true;
    }

    function close() {
        if (!session) return;
        const state = session;
        session = null;
        dialog.hidden = true;
        content.replaceChildren();
        if (!state.hadBodyClass) document.body.classList.remove("achievement-gallery-open");
        for (const saved of state.inertElements) {
            if (saved.value === null) saved.element.removeAttribute("inert");
            else saved.element.setAttribute("inert", saved.value);
        }
        state.styles.forEach(restoreStyle);
        const scrollBehavior = rememberStyle(document.documentElement, "scroll-behavior");
        document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
        window.scrollTo(state.scrollX, state.scrollY);
        restoreStyle(scrollBehavior);
        const target = state.trigger?.isConnected ? state.trigger : state.priorFocus?.isConnected ? state.priorFocus : null;
        if (target && typeof target.focus === "function" && !target.closest("[inert], [hidden]")) target.focus({ preventScroll: true });
    }

    window.AchievementGallery = Object.freeze({ open, close, get isOpen() { return Boolean(session); } });
})();
