const WORKER_BASE = "https://hope2.momentaneo2021.workers.dev/";
const CONTEUDO_CACHE_KEY = "sentinela-conteudo";
const TITULO_PADRAO = "Estudo de A Sentinela";
const COR_PADRAO = "#6c5ce7";
const OFFLINE_CACHE = "ass26-artigos-v1";
const SEMANAS_POR_LADO = 6;
const INDICE_CENTRAL = SEMANAS_POR_LADO;
const TOTAL_SEMANAS = SEMANAS_POR_LADO * 2 + 1;

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const ICONE_LIVRO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 1 4 16Z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 0 20 16Z"/></svg>';
const ICONE_LAPIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 4.5l3 3L8 19l-4 1 1-4Z"/><path d="M14.5 6.5l3 3"/></svg>';
const ICONE_NUVEM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.65-1.32A3.5 3.5 0 0 1 17.5 18"/><path d="M12 11.5v6"/><path d="M9.5 15l2.5 2.5 2.5-2.5"/></svg>';
const ICONE_RING = '<svg class="ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="2.4"/><circle class="ring-fg" cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" transform="rotate(-90 12 12)" stroke-dasharray="56.5" stroke-dashoffset="56.5"/></svg>';

class CarouselManager {
    constructor() {
        this.currentSlide = INDICE_CENTRAL;
        this.indiceCentral = INDICE_CENTRAL;
        this.totalSlides = TOTAL_SEMANAS;
        this.semanas = [];
        this.cards = [];
        this.chips = [];
        this.dotEls = [];
        this.baixando = {};
        this.semanaAtual = null;
        this.deck = null;
        this.rail = null;
        this.dots = null;
        this.btnEstudo = null;
        this.btnNotas = null;
        this.observer = null;
        this.init();
    }

    init() {
        try {
            this.gerarSemanas();
            this.deck = document.getElementById("deck");
            this.rail = document.getElementById("rail");
            this.dots = document.getElementById("dots");
            this.btnEstudo = document.querySelector(".act-primary");
            this.btnNotas = document.querySelector(".act-secondary");
            this.render();
            this.setupNavegacao();
            this.observarCartoes();
            this.setupCabecalho();

            const params = new URLSearchParams(window.location.search);
            const semanaParam = this.normalizeSemana(params.get("semana"));
            if (semanaParam) {
                const idx = this.semanas.findIndex((s) => s.parametro === semanaParam);
                if (idx !== -1) this.currentSlide = idx;
            }

            this.marcarAtivo(this.currentSlide);
            const alvo = this.currentSlide;
            requestAnimationFrame(() => this.goToSlide(alvo, false));

            this.atualizarConteudo();
            this.atualizarBotaoAtivo();
        } catch (error) {
            this.mostrarErro();
        }
    }

    normalizeSemana(value) {
        const match = String(value || "").match(/\b(\d{2}-\d{2})\b/);
        return match ? match[1] : "";
    }

    gerarSemanas() {
        const hoje = new Date();
        const dow = hoje.getDay();
        const diff = dow === 0 ? -6 : 1 - dow;
        const seg = new Date(hoje);
        seg.setDate(hoje.getDate() + diff);
        seg.setHours(0, 0, 0, 0);

        this.semanas = [];
        for (let i = -SEMANAS_POR_LADO; i <= SEMANAS_POR_LADO; i++) {
            const ini = new Date(seg);
            ini.setDate(seg.getDate() + i * 7);
            const fim = new Date(ini);
            fim.setDate(ini.getDate() + 6);
            const dia = String(ini.getDate()).padStart(2, "0");
            const mes = String(ini.getMonth() + 1).padStart(2, "0");
            this.semanas.push({
                parametro: `${dia}-${mes}`,
                dataISO: `${ini.getFullYear()}-${mes}-${dia}`,
                ini,
                fim,
                atual: i === 0
            });
        }

        this.semanaAtual = this.semanas[INDICE_CENTRAL].parametro;
        window.semanaAtual = this.semanaAtual;
    }

    rangeLongo(ini, fim) {
        if (ini.getMonth() === fim.getMonth()) {
            return `${ini.getDate()}–${fim.getDate()} de ${MESES[ini.getMonth()].toLowerCase()}`;
        }
        return `${ini.getDate()} ${MES_ABREV[ini.getMonth()]} – ${fim.getDate()} ${MES_ABREV[fim.getMonth()]}`;
    }

    escaparHtml(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    corValida(cor) {
        return cor && /^#[0-9a-fA-F]{3,6}$/.test(cor) ? cor : COR_PADRAO;
    }

    aplicarThemeColor(cor) {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", cor);
        document.body.style.backgroundColor = cor;
    }

    lerCache() {
        try {
            const raw = localStorage.getItem(CONTEUDO_CACHE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (error) {
            return {};
        }
    }

    dados(iso) {
        const c = this.lerCache()[iso];
        return c && typeof c === "object" ? c : {};
    }

    salvarDados(iso, dados) {
        try {
            const mapa = this.lerCache();
            mapa[iso] = dados;
            localStorage.setItem(CONTEUDO_CACHE_KEY, JSON.stringify(mapa));
        } catch (error) {}
    }

    render() {
        if (!this.deck || !this.rail) throw new Error("estrutura ausente");
        this.deck.innerHTML = "";
        this.rail.innerHTML = "";
        if (this.dots) this.dots.innerHTML = "";
        this.cards = [];
        this.chips = [];
        this.dotEls = [];

        this.semanas.forEach((s, i) => {
            const d = this.dados(s.dataISO);
            const cor = this.corValida(d.cor);

            const chip = document.createElement("button");
            chip.className = "chip" + (s.atual ? " current" : "");
            chip.innerHTML = `<span class="m">${MES_ABREV[s.ini.getMonth()]}</span><span class="d">${s.ini.getDate()}</span>`;
            chip.addEventListener("click", () => this.goToSlide(i, true));
            this.rail.appendChild(chip);
            this.chips.push(chip);

            if (this.dots) {
                const dot = document.createElement("div");
                dot.className = "dot";
                dot.addEventListener("click", () => this.goToSlide(i, true));
                this.dots.appendChild(dot);
                this.dotEls.push(dot);
            }

            const issue = document.createElement("div");
            issue.className = "issue";
            issue.innerHTML = `
                <div class="cover" style="--cc:${cor}">
                    <div class="cover-img"></div>
                    <div class="glow"></div>
                    <div class="cover-top">
                        <span class="pill">${this.rangeLongo(s.ini, s.fim)}</span>
                        ${s.atual ? '<span class="badge">Esta semana</span>' : ''}
                    </div>
                    <div class="cover-foot">
                        <div class="kicker">Estudo de A Sentinela</div>
                        <div class="title">${this.escaparHtml(d.titulo || TITULO_PADRAO)}</div>
                    </div>
                </div>`;
            this.deck.appendChild(issue);
            this.cards.push(issue);

            if (d.imagem) this.definirImagem(issue, d.imagem, cor);
        });
    }

    definirImagem(issue, imagem, cor) {
        const cover = issue.querySelector(".cover");
        if (cover) cover.style.setProperty("--cc", this.corValida(cor));
        const img = issue.querySelector(".cover-img");
        if (!img) return;
        if (!imagem) { img.style.backgroundImage = ""; return; }
        const im = new Image();
        im.onload = () => { img.style.backgroundImage = `url("${imagem}")`; };
        im.src = imagem;
    }

    setupNavegacao() {
        if (this.btnEstudo) {
            this.btnEstudo.addEventListener("click", () => {
                const s = this.semanas[this.currentSlide];
                if (!s) return;
                const estado = this.btnEstudo.dataset.estado;
                if (estado === "baixando") return;
                if (estado === "abrir") {
                    window.location.href = `sentinela/artigos/estudo.html?d=${s.dataISO}`;
                } else {
                    this.baixarArtigo(this.currentSlide, this.btnEstudo);
                }
            });
        }
        if (this.btnNotas) {
            this.btnNotas.addEventListener("click", () => {
                const s = this.semanas[this.currentSlide];
                if (s) window.location.href = `richtext/container.html?semana=${s.parametro}`;
            });
        }
    }

    observarCartoes() {
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach((e) => {
                if (e.isIntersecting && e.intersectionRatio > 0.6) {
                    const idx = this.cards.indexOf(e.target);
                    if (idx >= 0) this.marcarAtivo(idx);
                }
            });
        }, { root: this.deck, threshold: [0.6, 0.9] });
        this.cards.forEach((c) => this.observer.observe(c));
    }

    setupCabecalho() {
        const head = document.getElementById("head");
        if (!head || !this.rail) return;
        this.rail.classList.add("colapsada");
        head.classList.add("recolhido");
        requestAnimationFrame(() => this.rail.classList.add("anima"));
        head.addEventListener("click", () => {
            const agora = this.rail.classList.toggle("colapsada");
            head.classList.toggle("recolhido", agora);
        });
    }

    marcarAtivo(index) {
        if (index < 0 || index >= this.totalSlides) return;
        this.currentSlide = index;
        this.chips.forEach((c, i) => c.classList.toggle("active", i === index));
        this.dotEls.forEach((d, i) => d.classList.toggle("on", i === index));

        const s = this.semanas[index];
        const display = document.getElementById("semana-display");
        if (display && s) display.textContent = this.rangeLongo(s.ini, s.fim);

        if (s) {
            const corSemana = this.corValida(this.dados(s.dataISO).cor);
            document.documentElement.style.setProperty("--c", corSemana);
            this.aplicarThemeColor(corSemana);
        }

        this.atualizarBotaoAtivo();

        if (this.chips[index]) {
            this.chips[index].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        }
    }

    goToSlide(index, animate = true) {
        if (index < 0 || index >= this.totalSlides) return;
        const issue = this.cards[index];
        if (issue) issue.scrollIntoView({ behavior: animate ? "smooth" : "auto", inline: "center", block: "nearest" });
        this.marcarAtivo(index);
    }

    forceGoToWeek(semanaParametro) {
        const alvo = this.normalizeSemana(semanaParametro);
        const index = this.semanas.findIndex((s) => s.parametro === alvo);
        if (index !== -1) {
            this.goToSlide(index, false);
            return true;
        }
        return false;
    }

    getVisibleWeek() {
        return this.semanas[this.currentSlide] ? this.semanas[this.currentSlide].parametro : this.semanaAtual;
    }

    getCurrentWeek() {
        return this.semanaAtual;
    }

    definirEstadoBotao(btn, estado, pct) {
        if (!btn) return;
        btn.dataset.estado = estado;
        const ico = btn.querySelector(".act-ico");
        const label = btn.querySelector(".act-label");
        if (!ico || !label) return;
        if (estado === "abrir") {
            ico.innerHTML = ICONE_LIVRO;
            label.textContent = "Abrir estudo";
        } else if (estado === "baixando") {
            ico.innerHTML = ICONE_RING;
            label.textContent = "Baixando";
            this.progresso(btn, pct || 0);
        } else {
            ico.innerHTML = ICONE_NUVEM;
            label.textContent = "Baixar";
        }
    }

    progresso(btn, p) {
        const fg = btn.querySelector(".ring-fg");
        if (!fg) return;
        const v = Math.max(0, Math.min(1, p));
        fg.style.strokeDashoffset = String(56.5 * (1 - v));
    }

    async baixouAntes(iso) {
        if (!("caches" in window)) return false;
        try {
            const cache = await caches.open(OFFLINE_CACHE);
            const hit = await cache.match(`${WORKER_BASE}?semana=${iso}`);
            return !!hit && hit.ok && window.SentinelaArticleRuntime.isArticle(await hit.text());
        } catch (error) {
            return false;
        }
    }

    async atualizarBotaoAtivo() {
        const btn = this.btnEstudo;
        if (!btn) return;
        const s = this.semanas[this.currentSlide];
        if (!s) return;
        const iso = s.dataISO;
        if (iso in this.baixando) {
            this.definirEstadoBotao(btn, "baixando", this.baixando[iso]);
            return;
        }
        const tem = await this.baixouAntes(iso);
        const atualAgora = this.semanas[this.currentSlide];
        if (!atualAgora || atualAgora.dataISO !== iso) return;
        if (iso in this.baixando) {
            this.definirEstadoBotao(btn, "baixando", this.baixando[iso]);
            return;
        }
        this.definirEstadoBotao(btn, tem ? "abrir" : "baixar");
    }

    coletarAssets(html) {
        const base = new URL("sentinela/artigos/estudo.html", window.location.href).href;
        const urls = new Set();
        const add = (u) => {
            if (!u) return;
            try {
                const abs = new URL(u, base).href;
                if (abs.indexOf("http") === 0) urls.add(abs);
            } catch (error) {}
        };
        try {
            const doc = new DOMParser().parseFromString(html, "text/html");
            doc.querySelectorAll("link[href]").forEach((el) => {
                const rel = (el.getAttribute("rel") || "").toLowerCase();
                if (rel.indexOf("stylesheet") !== -1 || rel.indexOf("preload") !== -1 || rel.indexOf("icon") !== -1) add(el.getAttribute("href"));
            });
            doc.querySelectorAll("script[src]").forEach((el) => add(el.getAttribute("src")));
            doc.querySelectorAll("img").forEach((el) => { add(el.getAttribute("src")); add(el.getAttribute("data-src")); });
            doc.querySelectorAll("source[src]").forEach((el) => add(el.getAttribute("src")));
        } catch (error) {}
        const re = /https?:\/\/[^"'\s)]+\.(?:png|jpe?g|webp|gif|svg)/gi;
        let m;
        while ((m = re.exec(html)) !== null) add(m[0]);
        return Array.from(urls).filter((u) => u.indexOf("workers.dev") === -1 && u.indexOf("supabase") === -1);
    }

    async baixarArtigo(index, btn) {
        const s = this.semanas[index];
        if (!s) return;
        const iso = s.dataISO;
        if (!("caches" in window)) {
            window.location.href = `sentinela/artigos/estudo.html?d=${iso}`;
            return;
        }
        if (!navigator.onLine) {
            alert("Conecte-se à internet para baixar o estudo.");
            return;
        }
        const url = `${WORKER_BASE}?semana=${iso}`;
        this.baixando[iso] = 0;
        if (this.currentSlide === index) this.definirEstadoBotao(btn, "baixando", 0);
        const setP = (p) => {
            this.baixando[iso] = p;
            if (this.currentSlide === index && btn.dataset.estado === "baixando") this.progresso(btn, p);
        };
        try {
            const resp = await fetch(url, { cache: "reload" });
            if (!resp.ok) throw new Error("status");
            const html = await resp.text();
            if (!window.SentinelaArticleRuntime.isArticle(html)) throw new Error("nao-publicado");
            const cache = await caches.open(OFFLINE_CACHE);
            await cache.put(url, new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
            const assets = this.coletarAssets(html);
            const total = assets.length + 1;
            let loaded = 1;
            setP(loaded / total);
            await Promise.all(assets.map(async (a) => {
                try {
                    const mesmaOrigem = new URL(a).origin === window.location.origin;
                    const asset = await fetch(a, mesmaOrigem ? { cache: "reload" } : { mode: "no-cors", cache: "reload" });
                    if (asset.ok || asset.type === "opaque") await cache.put(a, asset);
                } catch (error) {}
                loaded++;
                setP(loaded / total);
            }));
            delete this.baixando[iso];
            if (this.currentSlide === index) this.definirEstadoBotao(btn, "abrir");
        } catch (error) {
            delete this.baixando[iso];
            if (this.currentSlide === index) this.definirEstadoBotao(btn, "baixar");
            if (error && error.message === "nao-publicado") {
                alert("O estudo desta semana ainda não foi publicado.");
            } else {
                alert("Não consegui baixar o estudo agora. Tente de novo.");
            }
        }
    }

    async buscarConteudo(iso) {
        try {
            const resp = await fetch(`${WORKER_BASE}?titulo=${encodeURIComponent(iso)}`, { cache: "no-store" });
            if (!resp.ok) return;
            const dados = await resp.json();
            if (!dados || !dados.titulo) return;
            const limpo = {
                titulo: String(dados.titulo).trim(),
                imagem: dados.imagem ? String(dados.imagem).trim() : "",
                cor: dados.cor ? String(dados.cor).trim() : ""
            };
            this.salvarDados(iso, limpo);
            this.aplicarConteudo(iso, limpo);
        } catch (error) {}
    }

    aplicarConteudo(iso, dados) {
        const index = this.semanas.findIndex((s) => s.dataISO === iso);
        if (index < 0) return;
        const issue = this.cards[index];
        if (!issue) return;
        const titulo = issue.querySelector(".title");
        if (titulo) titulo.textContent = dados.titulo || TITULO_PADRAO;
        this.definirImagem(issue, dados.imagem, dados.cor);
        if (index === this.currentSlide) {
            const corSemana = this.corValida(dados.cor);
            document.documentElement.style.setProperty("--c", corSemana);
            this.aplicarThemeColor(corSemana);
        }
    }

    atualizarConteudo() {
        if (!navigator.onLine) return;
        const cache = this.lerCache();
        const ordem = [this.currentSlide];
        for (let i = 0; i < this.semanas.length; i++) {
            if (i !== this.currentSlide) ordem.push(i);
        }
        ordem.forEach((i) => {
            const s = this.semanas[i];
            if (!s) return;
            const c = cache[s.dataISO];
            if (!c || !c.titulo) this.buscarConteudo(s.dataISO);
        });
    }

    mostrarErro() {
        const deck = document.getElementById("deck");
        if (deck) {
            deck.innerHTML = '<div class="issue"><div class="cover" style="--cc:#6c5ce7"><div class="cover-foot"><div class="title">Não consegui carregar. Tente de novo.</div></div></div></div>';
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    window.carousel = new CarouselManager();
});

window.goToWeek = (semana) => (window.carousel ? window.carousel.forceGoToWeek(semana) : false);
window.getCurrentWeek = () => (window.carousel ? window.carousel.getCurrentWeek() : null);
